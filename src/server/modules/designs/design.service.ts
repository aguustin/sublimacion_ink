import { createHash } from "node:crypto";
import { z } from "zod";
import type { EstadoPedido, Pedido, Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { lockOrder } from "@/server/modules/orders/order-payment.service";
import { transitionOrder } from "@/server/modules/orders/order-transitions";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

// Diseños de los personalizados (sección 15, INC-09): versiones numeradas e inmutables con huella,
// aprobación del cliente de la versión vigente (solo el cliente, D-19), pedido de cambios sin
// límite de rondas (D-29) y paso a producción bloqueado por RN-07. Cada operación bloquea el
// pedido, así que una versión nueva y una aprobación simultáneas se procesan de a una.

type Tx = Prisma.TransactionClient;

const MAX_FILES_PER_VERSION = 10;

/** Estados en los que el diseño avanza: antes o después del pago, también en producción (D-26). */
const DESIGN_STATES: readonly EstadoPedido[] = ["PENDIENTE_PAGO", "RESERVADO", "CONFIRMADO", "EN_PRODUCCION"];

const versionSchema = z.strictObject({
  archivoIds: z.array(z.uuid()).min(1, "Adjuntá al menos un archivo.").max(MAX_FILES_PER_VERSION),
  nota: z.string().trim().max(1000).optional(),
});
const approveSchema = z.strictObject({ huella: z.string().regex(/^[0-9a-f]{64}$/, "Huella inválida.") });
const changesSchema = z.strictObject({ comentario: z.string().trim().min(3, "Contanos qué cambiar.").max(2000) });
const transitionSchema = z.strictObject({
  estado: z.literal("EN_PRODUCCION", "Por ahora solo se puede pasar a producción."),
  motivo: z.string().trim().max(500).optional(),
});

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** 15.1: SHA-256 de la lista ordenada de los hashes de los archivos de la versión. */
export function versionFingerprint(fileHashes: readonly string[]): string {
  return createHash("sha256").update(fileHashes.join("\n")).digest("hex");
}

function assertDesignable(order: Pedido) {
  if (order.tipo !== "PERSONALIZADO" || !DESIGN_STATES.includes(order.estado)) {
    throw new AppError("ESTADO_INVALIDO", "El diseño de este pedido no se puede modificar en su estado actual.", 409, { estado: order.estado });
  }
}

async function notifyClient(tx: Tx, order: Pedido, tipo: string, titulo: string, mensaje: string) {
  const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
  await enqueueNotification(tx, { usuarioId: order.clienteId, email: client.email, tipo, titulo, mensaje });
}

/** 15.2 paso 5: aviso a la administración (dentro del sitio y por correo). */
async function notifyAdmins(tx: Tx, tipo: string, titulo: string, mensaje: string) {
  const admins = await tx.usuario.findMany({ where: { rol: "ADMIN" }, select: { id: true, email: true } });
  for (const admin of admins) await enqueueNotification(tx, { usuarioId: admin.id, email: admin.email, tipo, titulo, mensaje });
}

/**
 * RF-24, 15.3: el admin carga una versión nueva de un ítem personalizado. Pasa a ser la vigente y el
 * diseño queda pendiente de aprobación; la aprobación anterior queda como historia y deja de habilitar.
 * Con el pedido en producción también se permite (D-26): el pedido no avanza hasta que se apruebe.
 */
export async function createDesignVersion(actor: Actor, itemId: string, input: unknown, db: Db = getDb()) {
  const { archivoIds, nota } = versionSchema.parse(input);
  if (new Set(archivoIds).size !== archivoIds.length) throw new AppError("ARCHIVO_REPETIDO", "Un archivo está repetido.", 422);
  const item = isUuid(itemId) ? await db.itemPedido.findUnique({ where: { id: itemId }, select: { pedidoId: true } }) : null;
  if (!item) throw new AppError("ITEM_NO_ENCONTRADO", "No encontramos ese ítem.", 404);

  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, item.pedidoId);
    assertDesignable(order);

    // Solo archivos activos subidos como versión de diseño (16.1), en el orden indicado.
    const files = await tx.archivo.findMany({
      where: { id: { in: archivoIds }, estado: "ACTIVO", contexto: "VERSION_DISENO" },
      select: { id: true, hashSha256: true },
    });
    if (files.length !== archivoIds.length) throw new AppError("ARCHIVO_NO_ENCONTRADO", "No encontramos alguno de los archivos del diseño.", 404);
    const hashById = new Map(files.map((file) => [file.id, file.hashSha256]));

    const design = await tx.diseno.upsert({ where: { itemPedidoId: itemId }, create: { itemPedidoId: itemId }, update: {} });
    const last = await tx.versionDiseno.aggregate({ where: { disenoId: design.id }, _max: { numero: true } });
    const version = await tx.versionDiseno.create({
      data: {
        disenoId: design.id,
        numero: (last._max.numero ?? 0) + 1,
        nota: nota || null,
        creadaPorId: actor.id,
        huella: versionFingerprint(archivoIds.map((id) => hashById.get(id)!)),
        archivos: { create: archivoIds.map((archivoId, orden) => ({ archivoId, orden })) },
      },
    });
    await tx.diseno.update({ where: { id: design.id }, data: { versionVigenteId: version.id, estado: "PENDIENTE_APROBACION" } });

    const inProduction = order.estado === "EN_PRODUCCION";
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "VERSION_DISENO_CARGADA",
      entidad: "pedido",
      entidadId: order.id,
      datos: { itemId, versionId: version.id, numero: version.numero, huella: version.huella, requiereNuevaAprobacionEnProduccion: inProduction },
      ip: actor.ip,
    });
    await notifyClient(
      tx,
      order,
      "VERSION_DISENO_CARGADA",
      `Pedido #${order.numero}: diseño versión ${version.numero}`,
      inProduction
        ? `Hay una versión nueva del diseño (${version.numero}). El pedido no avanza hasta que la apruebes.`
        : `Te cargamos la versión ${version.numero} del diseño. Revisala y aprobala o pedí cambios.`,
    );
    return version;
  });
}

/** Versión con su diseño, ítem y pedido; un pedido ajeno se trata como inexistente (T-25). */
async function findClientVersion(tx: Tx, user: SessionUser, versionId: string) {
  const version = isUuid(versionId)
    ? await tx.versionDiseno.findFirst({
        where: { id: versionId, diseno: { item: { pedido: { clienteId: user.id } } } },
        include: { diseno: { include: { item: true } } },
      })
    : null;
  if (!version) throw new AppError("VERSION_NO_ENCONTRADA", "No encontramos esa versión del diseño.", 404);
  const order = await lockOrder(tx, version.diseno.item.pedidoId, { clienteId: user.id });
  assertDesignable(order);
  // Releída con el pedido bloqueado: una versión nueva cargada mientras tanto ya cuenta.
  const design = await tx.diseno.findUniqueOrThrow({ where: { id: version.disenoId } });
  if (design.versionVigenteId !== version.id) {
    throw new AppError("VERSION_NO_VIGENTE", "Esa versión ya no es la vigente. Revisá la última.", 409);
  }
  return { version, design, order };
}

/**
 * RF-25, 15.2: el cliente aprueba exactamente lo que vio: la versión vigente y su huella. La
 * aprobación es única por versión; el estado del diseño es informativo (15.4).
 */
export async function approveDesignVersion(user: SessionUser, versionId: string, input: unknown, db: Db = getDb()) {
  const { huella } = approveSchema.parse(input);
  return db.$transaction(async (tx) => {
    const { version, design, order } = await findClientVersion(tx, user, versionId);
    if (huella !== version.huella) throw new AppError("HUELLA_DISTINTA", "La versión cambió desde que la viste. Volvé a revisarla.", 409);
    if (await tx.aprobacionDiseno.findUnique({ where: { versionId: version.id } })) {
      throw new AppError("VERSION_YA_APROBADA", "Esa versión ya está aprobada.", 409);
    }
    const approval = await tx.aprobacionDiseno.create({ data: { versionId: version.id, aprobadaPorId: user.id, huellaAprobada: huella } });
    await tx.diseno.update({ where: { id: design.id }, data: { estado: "APROBADO" } });
    await recordAudit(tx, {
      actorId: user.id,
      accion: "DISENO_APROBADO",
      entidad: "pedido",
      entidadId: order.id,
      datos: { versionId: version.id, numero: version.numero, huella },
    });
    await notifyAdmins(
      tx,
      "DISENO_APROBADO",
      `Pedido #${order.numero}: diseño aprobado`,
      `El cliente aprobó la versión ${version.numero} del diseño.`,
    );
    return approval;
  });
}

/** RF-26: el cliente pide cambios sobre la versión vigente todavía no aprobada; hace falta una versión nueva. */
export async function requestDesignChanges(user: SessionUser, versionId: string, input: unknown, db: Db = getDb()) {
  const { comentario } = changesSchema.parse(input);
  return db.$transaction(async (tx) => {
    const { version, design, order } = await findClientVersion(tx, user, versionId);
    if (await tx.aprobacionDiseno.findUnique({ where: { versionId: version.id } })) {
      throw new AppError("VERSION_YA_APROBADA", "Esa versión ya está aprobada.", 409);
    }
    const request = await tx.solicitudCambio.create({ data: { versionId: version.id, autorId: user.id, comentario } });
    await tx.diseno.update({ where: { id: design.id }, data: { estado: "CAMBIOS_SOLICITADOS" } });
    await recordAudit(tx, {
      actorId: user.id,
      accion: "CAMBIOS_DISENO_SOLICITADOS",
      entidad: "pedido",
      entidadId: order.id,
      datos: { versionId: version.id, comentario },
    });
    await notifyAdmins(
      tx,
      "CAMBIOS_DISENO_SOLICITADOS",
      `Pedido #${order.numero}: cambios en el diseño`,
      `El cliente pidió cambios en la versión ${version.numero}: ${comentario}`,
    );
    return request;
  });
}

/**
 * RF-27: el admin pasa un pedido confirmado a producción. RN-07 se valida dentro de la transición,
 * con el pedido bloqueado. Las demás transiciones administrativas (listo, despacho, entrega) son de INC-12.
 */
export async function startProduction(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { motivo } = transitionSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);
    if (order.estado !== "CONFIRMADO") {
      throw new AppError("ESTADO_INVALIDO", "Solo un pedido confirmado (con el pago o la seña registrados) pasa a producción.", 409, {
        estado: order.estado,
      });
    }
    const moved = await transitionOrder(tx, { pedidoId, from: "CONFIRMADO", to: "EN_PRODUCCION", actorId: actor.id, motivo });
    if (!moved) throw new AppError("ESTADO_INVALIDO", "El pedido cambió de estado. Volvé a cargarlo.", 409);
    await recordAudit(tx, { actorId: actor.id, accion: "PEDIDO_EN_PRODUCCION", entidad: "pedido", entidadId: pedidoId, ip: actor.ip });
    await notifyClient(tx, order, "PEDIDO_EN_PRODUCCION", `Pedido #${order.numero} en producción`, "Empezamos a fabricar tu pedido.");
    return { estado: "EN_PRODUCCION" as const };
  });
}

/** RF-28: diseños de un pedido, con sus versiones, archivos, aprobación y pedidos de cambio. */
export function getOrderDesigns(pedidoId: string, db: Db = getDb()) {
  return db.itemPedido.findMany({
    where: { pedidoId, pedido: { tipo: "PERSONALIZADO" } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      descripcion: true,
      diseno: {
        select: {
          estado: true,
          versionVigenteId: true,
          versiones: {
            orderBy: { numero: "asc" },
            select: {
              id: true,
              numero: true,
              nota: true,
              creadaEn: true,
              huella: true,
              archivos: { orderBy: { orden: "asc" }, select: { archivo: { select: { id: true, nombreOriginal: true } } } },
              aprobacion: { select: { aprobadaEn: true } },
              solicitudes: { orderBy: { creadoEn: "asc" }, select: { comentario: true, creadoEn: true } },
            },
          },
        },
      },
    },
  });
}

/** Lo mismo, solo para el dueño del pedido (404 si es ajeno). */
export async function getCustomerOrderDesigns(user: SessionUser, pedidoId: string, db: Db = getDb()) {
  const order = isUuid(pedidoId) ? await db.pedido.findFirst({ where: { id: pedidoId, clienteId: user.id }, select: { id: true } }) : null;
  if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  return getOrderDesigns(order.id, db);
}
