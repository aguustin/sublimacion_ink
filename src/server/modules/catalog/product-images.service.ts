import { z } from "zod";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { getStorage, type ObjectStorage } from "@/server/modules/files/storage";
import { getConfig } from "@/server/shared/config";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

// Imágenes de productos (RF-07) sobre el sistema general de archivos (16.1): el admin sube el
// archivo con contexto PRODUCTO y después lo asocia al producto.

const attachSchema = z.strictObject({ archivoId: z.uuid("Indicá el archivo.") });

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function attachProductImage(actor: Actor, productoId: string, input: unknown, db: Db = getDb()) {
  const { archivoId } = attachSchema.parse(input);
  if (!isUuid(productoId)) throw new AppError("PRODUCTO_NO_ENCONTRADO", "No existe ese producto.", 404);
  return db.$transaction(async (tx) => {
    const product = await tx.producto.findUnique({ where: { id: productoId }, select: { id: true } });
    if (!product) throw new AppError("PRODUCTO_NO_ENCONTRADO", "No existe ese producto.", 404);
    const archivo = await tx.archivo.findFirst({
      where: { id: archivoId, estado: "ACTIVO", contexto: "PRODUCTO" },
      include: { imagenProducto: true },
    });
    if (!archivo) throw new AppError("ARCHIVO_NO_ENCONTRADO", "No encontramos esa imagen.", 404);
    if (archivo.imagenProducto) throw new AppError("IMAGEN_YA_ASOCIADA", "Esa imagen ya está asociada a un producto.", 409);
    if (archivo.tipoMimeDetectado === "application/pdf") throw new AppError("TIPO_NO_PERMITIDO", "Un PDF no puede ser imagen de un producto.", 422);

    const last = await tx.imagenProducto.aggregate({ where: { productoId }, _max: { orden: true } });
    const imagen = await tx.imagenProducto.create({ data: { productoId, archivoId, orden: (last._max.orden ?? 0) + 1 } });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "IMAGEN_PRODUCTO_AGREGADA",
      entidad: "producto",
      entidadId: productoId,
      datos: { archivoId },
      ip: actor.ip,
    });
    return imagen;
  });
}

/** Quita la imagen del producto y da de baja el archivo (baja lógica, 16.1). */
export async function removeProductImage(actor: Actor, productoId: string, archivoId: string, db: Db = getDb()) {
  if (!isUuid(productoId) || !isUuid(archivoId)) throw new AppError("IMAGEN_NO_ENCONTRADA", "No encontramos esa imagen.", 404);
  await db.$transaction(async (tx) => {
    const removed = await tx.imagenProducto.deleteMany({ where: { productoId, archivoId } });
    if (removed.count === 0) throw new AppError("IMAGEN_NO_ENCONTRADA", "No encontramos esa imagen.", 404);
    await tx.archivo.updateMany({
      where: { id: archivoId, estado: "ACTIVO" },
      data: { estado: "ELIMINADO", eliminadoEn: new Date(), eliminadoPorId: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "IMAGEN_PRODUCTO_QUITADA",
      entidad: "producto",
      entidadId: productoId,
      datos: { archivoId },
      ip: actor.ip,
    });
  });
}

/**
 * URLs firmadas de las imágenes de productos para mostrarlas en el catálogo. Son públicas por
 * naturaleza, pero el bucket sigue privado: solo se firman archivos activos asociados a un producto.
 */
export async function productImageUrls(archivoIds: string[], { db = getDb(), storage = getStorage() }: { db?: Db; storage?: ObjectStorage } = {}) {
  if (archivoIds.length === 0) return new Map<string, string>();
  const archivos = await db.archivo.findMany({
    where: { id: { in: archivoIds }, estado: "ACTIVO", contexto: "PRODUCTO", imagenProducto: { isNot: null } },
    select: { id: true, claveObjeto: true, tipoMimeDetectado: true, nombreOriginal: true },
  });
  const expiresInSeconds = getConfig().FILES_URL_TTL_SECONDS;
  const entries = await Promise.all(
    archivos.map(async (archivo) => {
      const url = await storage.signedGetUrl(archivo.claveObjeto, {
        expiresInSeconds,
        contentType: archivo.tipoMimeDetectado,
        fileName: archivo.nombreOriginal,
      });
      return [archivo.id, url] as const;
    }),
  );
  return new Map(entries);
}
