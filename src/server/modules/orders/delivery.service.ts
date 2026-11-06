import { z } from "zod";
import type { EstadoPedido, Pedido, Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { consumeRetention } from "@/server/modules/inventory/stock-retention.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { lockOrder } from "./order-payment.service";
import { transitionOrder } from "./order-transitions";

type Tx = Prisma.TransactionClient;

// Entregas (F-06, RF-43). Sin estados propios (D-06): el avance son los estados del pedido; `Entrega`
// guarda los datos de seguimiento y quién hizo cada paso. Las guardas del saldo (RN-21) y de los diseños
// aprobados (RN-07) viven en `transitionOrder`, así que estas operaciones las heredan.

const optionalText = (max: number) => z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().max(max).optional());

const trackingSchema = z.strictObject({
  transportista: optionalText(100),
  codigoSeguimiento: optionalText(100),
});

const deliverySchema = z.discriminatedUnion(
  "estado",
  [
    z.strictObject({ estado: z.literal("LISTO_PARA_RETIRO"), motivo: optionalText(500) }),
    z.strictObject({ estado: z.literal("DESPACHADO"), motivo: optionalText(500), ...trackingSchema.shape }),
    z.strictObject({ estado: z.literal("ENTREGADO"), motivo: optionalText(500) }),
  ],
  { error: "Indicá un estado válido." },
);

/** Estados de entrega que acepta `POST /admin/orders/:id/transitions` además de `EN_PRODUCCION`. */
export const DELIVERY_STATES: readonly EstadoPedido[] = ["LISTO_PARA_RETIRO", "DESPACHADO", "ENTREGADO"];

/** RN-04: hay demora cuando el despacho ocurre después de la fecha comprometida (RN-14). */
export function isDispatchLate(fechaComprometida: Date | null, despachadoEn: Date | null | undefined): boolean {
  return fechaComprometida !== null && despachadoEn != null && despachadoEn > fechaComprometida;
}

async function notifyClient(tx: Tx, order: Pedido, tipo: string, titulo: string, mensaje: string) {
  const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
  await enqueueNotification(tx, { usuarioId: order.clienteId, email: client.email, tipo, titulo, mensaje });
}

/** Las unidades salen del stock físico al despachar o entregar (14.6). Idempotente: solo consume las activas. */
async function consumeOrderRetentions(tx: Tx, pedidoId: string): Promise<void> {
  const active = await tx.retencionStock.findMany({ where: { pedidoId, estado: "ACTIVA" }, orderBy: { varianteId: "asc" }, select: { id: true } });
  for (const { id } of active) await consumeRetention(tx, id);
}

function assertState(order: Pedido, allowed: readonly EstadoPedido[], message: string) {
  if (!allowed.includes(order.estado)) throw new AppError("ESTADO_INVALIDO", message, 409, { estado: order.estado });
}

async function move(tx: Tx, order: Pedido, to: EstadoPedido, actor: Actor, motivo?: string) {
  const moved = await transitionOrder(tx, { pedidoId: order.id, from: order.estado, to, actorId: actor.id, motivo });
  if (!moved) throw new AppError("ESTADO_INVALIDO", "El pedido cambió de estado. Volvé a cargarlo.", 409);
}

/** Transiciones de entrega del admin (9.3): listo para retirar, despachado y entregado. */
export async function advanceDelivery(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const data = deliverySchema.parse(input);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);

    if (data.estado === "LISTO_PARA_RETIRO") {
      if (order.modalidadEntrega !== "RETIRO") throw new AppError("MODALIDAD_INVALIDA", "Este pedido se envía: se despacha, no se retira.", 409);
      assertState(order, ["CONFIRMADO", "EN_PRODUCCION"], "Solo un pedido confirmado o en producción puede quedar listo para retirar.");
      await move(tx, order, "LISTO_PARA_RETIRO", actor, data.motivo);
      await tx.entrega.upsert({
        where: { pedidoId },
        create: { pedidoId, listoEn: now, listoPorId: actor.id },
        update: { listoEn: now, listoPorId: actor.id },
      });
      await notifyClient(
        tx,
        order,
        "PEDIDO_LISTO_PARA_RETIRO",
        `Pedido #${order.numero} listo para retirar`,
        "Tu pedido ya está listo: podés retirarlo en el local.",
      );
    }

    if (data.estado === "DESPACHADO") {
      if (order.modalidadEntrega !== "ENVIO") throw new AppError("MODALIDAD_INVALIDA", "Este pedido se retira en el local: no se despacha.", 409);
      assertState(order, ["CONFIRMADO", "EN_PRODUCCION"], "Solo un pedido confirmado o en producción se puede despachar.");
      await move(tx, order, "DESPACHADO", actor, data.motivo);
      await consumeOrderRetentions(tx, pedidoId);
      const tracking = { transportista: data.transportista ?? null, codigoSeguimiento: data.codigoSeguimiento ?? null };
      await tx.entrega.upsert({
        where: { pedidoId },
        create: { pedidoId, ...tracking, despachadoEn: now, despachadoPorId: actor.id },
        update: { ...tracking, despachadoEn: now, despachadoPorId: actor.id },
      });
      const trackingText = [
        tracking.transportista && `Transporte: ${tracking.transportista}.`,
        tracking.codigoSeguimiento && `Seguimiento: ${tracking.codigoSeguimiento}.`,
      ]
        .filter(Boolean)
        .join(" ");
      await notifyClient(
        tx,
        order,
        "PEDIDO_DESPACHADO",
        `Pedido #${order.numero} despachado`,
        `Despachamos tu pedido.${trackingText ? ` ${trackingText}` : ""}`,
      );
    }

    if (data.estado === "ENTREGADO") {
      assertState(order, ["LISTO_PARA_RETIRO", "DESPACHADO"], "Solo un pedido listo para retirar o despachado se puede marcar como entregado.");
      await move(tx, order, "ENTREGADO", actor, data.motivo);
      // En el retiro las unidades salen recién al entregar (14.6, "si no se hizo antes").
      await consumeOrderRetentions(tx, pedidoId);
      await tx.entrega.upsert({
        where: { pedidoId },
        create: { pedidoId, entregadoEn: now, entregadoPorId: actor.id },
        update: { entregadoEn: now, entregadoPorId: actor.id },
      });
      await notifyClient(
        tx,
        order,
        "PEDIDO_ENTREGADO",
        `Pedido #${order.numero} entregado`,
        "Registramos la entrega de tu pedido. ¡Gracias por tu compra!",
      );
    }

    await recordAudit(tx, {
      actorId: actor.id,
      accion: `PEDIDO_${data.estado}`,
      entidad: "pedido",
      entidadId: pedidoId,
      datos:
        data.estado === "DESPACHADO" ? { transportista: data.transportista ?? null, codigoSeguimiento: data.codigoSeguimiento ?? null } : undefined,
      ip: actor.ip,
    });
    return { estado: data.estado };
  });
}

/** `PATCH /admin/orders/:id/delivery`: corrige los datos de seguimiento de un envío ya despachado. */
export async function updateTracking(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const data = trackingSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);
    const entrega = await tx.entrega.findUnique({ where: { pedidoId } });
    if (order.modalidadEntrega !== "ENVIO" || !entrega?.despachadoEn) {
      throw new AppError("ESTADO_INVALIDO", "Los datos de seguimiento se cargan en un envío ya despachado.", 409, { estado: order.estado });
    }
    const updated = await tx.entrega.update({
      where: { pedidoId },
      data: { transportista: data.transportista ?? null, codigoSeguimiento: data.codigoSeguimiento ?? null },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "SEGUIMIENTO_ACTUALIZADO",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { transportista: updated.transportista, codigoSeguimiento: updated.codigoSeguimiento },
      ip: actor.ip,
    });
    return { transportista: updated.transportista, codigoSeguimiento: updated.codigoSeguimiento };
  });
}
