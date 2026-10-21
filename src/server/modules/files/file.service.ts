import { createHash } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { getConfig } from "@/server/shared/config";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { logger } from "@/server/shared/logger";
import { ADMIN_CONTEXTS, CLIENT_CONTEXTS, detectFileType, objectKeyFor, sanitizeOriginalName } from "./file.policy";
import { getStorage, type ObjectStorage } from "./storage";

// Archivos (16.1): subida validada, metadatos en la base, binario en S3 y descarga con URL firmada
// solo después de autorizar.

type Options = { db?: Db; storage?: ObjectStorage; maxBytes?: number };

const contextSchema = z.enum(["REFERENCIA", "VERSION_DISENO", "CHAT", "PRODUCTO", "COMPROBANTE"], "Indicá un contexto válido.");

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const notFound = () => new AppError("ARCHIVO_NO_ENCONTRADO", "No encontramos ese archivo.", 404);

export function tooLarge(maxBytes: number) {
  return new AppError("ARCHIVO_DEMASIADO_GRANDE", `El archivo supera el máximo de ${Math.floor(maxBytes / (1024 * 1024))} MB.`, 413);
}

/**
 * Valida y guarda un archivo. Primero el objeto y después los metadatos; si los metadatos fallan,
 * se borra el objeto (compensación). Si ese borrado también falla, queda un objeto huérfano sin
 * registro, que nunca es accesible (no hay URL sin registro) y se limpia en INC-14.
 */
export async function uploadFile(user: SessionUser, input: { file: unknown; contexto: unknown }, options: Options = {}) {
  const { db = getDb(), storage = getStorage(), maxBytes = getConfig().FILES_MAX_BYTES } = options;
  const contexto = contextSchema.parse(input.contexto);
  const allowed = user.rol === "ADMIN" ? ADMIN_CONTEXTS : CLIENT_CONTEXTS;
  if (!allowed.includes(contexto)) throw new AppError("CONTEXTO_NO_PERMITIDO", "No podés subir archivos en ese contexto.", 403);

  const { file } = input;
  if (!(file instanceof File) || file.size === 0) throw new AppError("ARCHIVO_REQUERIDO", "Elegí un archivo.", 422);
  if (file.size > maxBytes) throw tooLarge(maxBytes);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectFileType(bytes);
  if (!mime) throw new AppError("TIPO_NO_PERMITIDO", "Solo se aceptan archivos JPG, PNG, WEBP o PDF.", 415);

  const claveObjeto = objectKeyFor(contexto, mime);
  try {
    await storage.put(claveObjeto, bytes, mime);
  } catch (error) {
    logger.error({ err: error, claveObjeto }, "no se pudo guardar el archivo");
    throw new AppError("ALMACENAMIENTO_NO_DISPONIBLE", "No pudimos guardar el archivo. Intentá de nuevo en unos minutos.", 503);
  }

  try {
    return await db.$transaction(async (tx) => {
      const archivo = await tx.archivo.create({
        data: {
          claveObjeto,
          nombreOriginal: sanitizeOriginalName(file.name),
          tipoMimeDetectado: mime,
          tamanoBytes: bytes.length,
          hashSha256: createHash("sha256").update(bytes).digest("hex"),
          subidoPorId: user.id,
          propietarioClienteId: user.rol === "ADMIN" ? null : user.id,
          contexto,
        },
      });
      await recordAudit(tx, {
        actorId: user.id,
        accion: "ARCHIVO_SUBIDO",
        entidad: "archivo",
        entidadId: archivo.id,
        datos: { contexto, tipo: mime, tamanoBytes: archivo.tamanoBytes },
      });
      return toPublic(archivo);
    });
  } catch (error) {
    await storage.delete(claveObjeto).catch((cleanupError: unknown) => {
      logger.error({ err: cleanupError, claveObjeto }, "objeto huérfano: no se pudo borrar tras fallar los metadatos");
    });
    throw error;
  }
}

/** Lo que se devuelve al cliente: nunca la clave del objeto ni datos del almacenamiento. */
function toPublic(archivo: { id: string; nombreOriginal: string; tipoMimeDetectado: string; tamanoBytes: number; contexto: string; creadoEn: Date }) {
  const { id, nombreOriginal, tipoMimeDetectado, tamanoBytes, contexto, creadoEn } = archivo;
  return { id, nombreOriginal, tipo: tipoMimeDetectado, tamanoBytes, contexto, creadoEn };
}

/**
 * Control de acceso (16.1): el admin, cualquiera; el cliente, solo los propios. Un archivo ajeno,
 * eliminado o inexistente responde lo mismo (404), sin revelar que existe (T-41).
 */
async function findAccessible(db: Db, user: SessionUser, id: string) {
  // El cliente: los propios y las referencias de sus pedidos (INC-08.1).
  const access =
    user.rol === "ADMIN"
      ? {}
      : {
          OR: [
            { propietarioClienteId: user.id },
            { referencias: { some: { pedido: { clienteId: user.id } } } },
            // Diseños de sus pedidos (INC-09).
            { versionesDiseno: { some: { version: { diseno: { item: { pedido: { clienteId: user.id } } } } } } },
          ],
        };
  const archivo = isUuid(id) ? await db.archivo.findFirst({ where: { id, estado: "ACTIVO", ...access } }) : null;
  if (!archivo) throw notFound();
  return archivo;
}

/** URL firmada de corta duración, generada solo después de autorizar. */
export async function getFileUrl(user: SessionUser, id: string, { db = getDb(), storage = getStorage() }: Options = {}) {
  const archivo = await findAccessible(db, user, id);
  const expiresInSeconds = getConfig().FILES_URL_TTL_SECONDS;
  const url = await storage.signedGetUrl(archivo.claveObjeto, {
    expiresInSeconds,
    contentType: archivo.tipoMimeDetectado,
    fileName: archivo.nombreOriginal,
  });
  return { url, expiraEn: new Date(Date.now() + expiresInSeconds * 1000) };
}

/** Baja lógica: el objeto se conserva hasta la política de retención (D-27, INC-14). */
export async function deleteFile(user: SessionUser, id: string, db: Db = getDb()) {
  const archivo = await findAccessible(db, user, id);
  // Una referencia de un pedido es parte de la solicitud: la tienda la necesita para cotizar y producir.
  if (await db.referenciaPedido.count({ where: { archivoId: archivo.id } })) {
    throw new AppError("ARCHIVO_EN_USO", "Este archivo es una referencia de un pedido y no se puede eliminar.", 409);
  }
  // Un archivo de una versión de diseño es parte de lo que se aprueba y se fabrica (RN-P-05).
  if (await db.archivoVersionDiseno.count({ where: { archivoId: archivo.id } })) {
    throw new AppError("ARCHIVO_EN_USO", "Este archivo es parte de un diseño y no se puede eliminar.", 409);
  }
  await db.$transaction(async (tx) => {
    const deleted = await tx.archivo.updateMany({
      where: { id: archivo.id, estado: "ACTIVO" },
      data: { estado: "ELIMINADO", eliminadoEn: new Date(), eliminadoPorId: user.id },
    });
    if (deleted.count === 0) throw notFound();
    await recordAudit(tx, { actorId: user.id, accion: "ARCHIVO_ELIMINADO", entidad: "archivo", entidadId: archivo.id });
  });
}
