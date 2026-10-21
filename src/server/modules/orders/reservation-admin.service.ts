import { z } from "zod";
import type { Pedido, Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { reconsumeCoupon } from "@/server/modules/coupons/coupon.service";
import { couponDiscount } from "@/server/modules/coupons/coupon.policy";
import { reserveStock } from "@/server/modules/inventory/stock-retention.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { contactSentence, getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { cashReservationExpiry } from "./holidays.service";
import { confirmationWithoutPaymentData, lockOrder, NO_PAYMENT_REQUIRED } from "./order-payment.service";
import { applyCurrentPrices, assertPurchasable, findOrderWithItems as findOrder, priceAtCurrentRates, type OrderWithItems } from "./order-pricing";
import { transitionOrder } from "./order-transitions";

// Extensión y reactivación de reservas en efectivo, solo por el admin (RN-28, F-02b).

type Tx = Prisma.TransactionClient;

const reason = z.string().trim().min(3, "Indicá el motivo.").max(500);

const extendSchema = z.strictObject({
  venceEn: z.iso.datetime({ offset: true, error: "Indicá la nueva fecha y hora." }).transform((value) => new Date(value)),
  motivo: reason,
});

const reactivateSchema = z.strictObject({
  motivo: reason,
  /** Total que el admin vio en la vista previa: si cambió, se rechaza (RN-27). */
  totalEsperadoCentavos: z.number().int().min(0),
});

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

async function notifyClient(tx: Tx, order: Pedido, titulo: string, mensaje: string, tipo: string) {
  const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
  await enqueueNotification(tx, {
    usuarioId: order.clienteId,
    email: client.email,
    tipo,
    titulo,
    mensaje: mensaje + contactSentence(await getStoreContact(tx)),
  });
}

/** Extiende una reserva vigente: el nuevo vencimiento tiene que ser futuro y posterior al actual. */
export async function extendReservation(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { venceEn, motivo } = extendSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);
    if (order.estado !== "RESERVADO") {
      throw new AppError("ESTADO_INVALIDO", "Solo se extienden reservas en efectivo pendientes de pago.", 409, { estado: order.estado });
    }
    if (!order.venceEn || order.venceEn <= new Date()) {
      throw new AppError("RESERVA_VENCIDA", "La reserva ya venció: reactivala en lugar de extenderla.", 409);
    }
    if (venceEn <= order.venceEn) {
      throw new AppError("FECHA_INVALIDA", "La nueva fecha tiene que ser posterior al vencimiento actual.", 422);
    }

    await tx.pedido.updateMany({ where: { id: pedidoId, estado: "RESERVADO" }, data: { venceEn } });
    await tx.extensionReserva.create({
      data: { pedidoId, tipo: "EXTENSION", venceEnAnterior: order.venceEn, venceEnNuevo: venceEn, motivo, autorId: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "RESERVA_EXTENDIDA",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { venceEnAnterior: order.venceEn.toISOString(), venceEnNuevo: venceEn.toISOString(), motivo },
      ip: actor.ip,
    });
    await notifyClient(
      tx,
      order,
      `Pedido #${order.numero}: reserva extendida`,
      `Extendimos tu reserva: podés pagarla en el local hasta el ${dateFormat.format(venceEn)}.`,
      "RESERVA_EXTENDIDA",
    );
    return { venceEn };
  });
}

/** Solo una reserva estándar en efectivo que venció por falta de pago (no una cancelada). */
async function assertReactivable(db: DbClient, order: OrderWithItems): Promise<void> {
  if (order.tipo === "PERSONALIZADO") {
    throw new AppError("REACTIVACION_NO_PERMITIDA", "Los personalizados vencidos no se reactivan: reemití la cotización.", 409);
  }
  const last = await db.historialEstadoPedido.findFirst({ where: { pedidoId: order.id }, orderBy: { creadoEn: "desc" } });
  const expiredReservation =
    order.estado === "VENCIDO" && order.modalidadCierre === "EFECTIVO" && last?.estadoNuevo === "VENCIDO" && last.motivo === "VENCIMIENTO_RESERVA";
  if (!expiredReservation) {
    throw new AppError("REACTIVACION_NO_PERMITIDA", "Solo se reactivan reservas en efectivo vencidas por falta de pago.", 409, {
      estado: order.estado,
    });
  }
}

/** Lo que el admin ve antes de reactivar: precios vigentes, cupón, total y si hay stock. */
export async function getReactivationPreview(pedidoId: string, db: Db = getDb()) {
  const order = await findOrder(db, pedidoId);
  await assertReactivable(db, order);
  const pricing = priceAtCurrentRates(order);
  // RN-28 [PROPUESTA]: si el pedido usaba un cupón, tiene que seguir disponible.
  const coupon = order.cuponId ? await db.cupon.findUniqueOrThrow({ where: { id: order.cuponId } }) : null;
  const cuponDisponible = !coupon || (coupon.estado === "ACTIVO" && coupon.venceEn > new Date());
  const descuentoCuponCentavos = coupon && cuponDisponible ? couponDiscount(coupon.montoCentavos, pricing.totalCentavos) : 0;
  return {
    ...pricing,
    subtotalProductosCentavos: pricing.totalCentavos,
    descuentoCuponCentavos,
    totalCentavos: pricing.totalCentavos - descuentoCuponCentavos,
    cuponDisponible,
    puedeReactivarse: pricing.puedeReactivarse && cuponDisponible,
  };
}

/**
 * Reactiva una reserva vencida: vuelve a retener el stock de todos los ítems con la retención
 * atómica de 14.3 (si uno no alcanza, no cambia nada), actualiza los precios, calcula un nuevo
 * vencimiento hábil desde ahora (RN-29) y avisa al cliente.
 */
export async function reactivateReservation(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { motivo, totalEsperadoCentavos } = reactivateSchema.parse(input);
  return db.$transaction(async (tx) => {
    await lockOrder(tx, pedidoId);
    const order = await findOrder(tx, pedidoId);
    await assertReactivable(tx, order);

    const pricing = priceAtCurrentRates(order);
    assertPurchasable(pricing);
    // RN-28 [PROPUESTA]: el cupón se vuelve a usar en este pedido; si ya no está disponible, no se reactiva.
    const coupon = order.cuponId ? await reconsumeCoupon(tx, order.cuponId, pedidoId) : null;
    const discount = coupon ? couponDiscount(coupon.montoCentavos, pricing.totalCentavos) : 0;
    const totalCentavos = pricing.totalCentavos - discount;
    if (totalCentavos !== totalEsperadoCentavos) {
      throw new AppError("PRECIO_CAMBIADO", "El total cambió. Revisá la vista previa antes de reactivar.", 409, { totalCentavos });
    }

    const now = new Date();
    // RN-05: misma retención atómica que el checkout; sin stock suficiente se revierte todo.
    await reserveStock(
      tx,
      pedidoId,
      order.items.map(({ varianteId, cantidad }) => ({ varianteId, cantidad })),
    );
    await applyCurrentPrices(tx, pricing);

    // RN-32: si con los precios vigentes y el cupón el total final es $0, se confirma sin pago.
    if (totalCentavos === 0) {
      const confirmed = await transitionOrder(tx, {
        pedidoId,
        from: "VENCIDO",
        to: "CONFIRMADO",
        actorId: actor.id,
        motivo: NO_PAYMENT_REQUIRED,
        at: now,
        data: {
          ...confirmationWithoutPaymentData(),
          subtotalProductosCentavos: pricing.totalCentavos,
          descuentoCuponCentavos: discount,
          totalCentavos,
        },
      });
      if (!confirmed) throw new AppError("REACTIVACION_NO_PERMITIDA", "El pedido cambió de estado. Volvé a cargarlo.", 409);
      await recordAudit(tx, {
        actorId: actor.id,
        accion: "RESERVA_REACTIVADA",
        entidad: "pedido",
        entidadId: pedidoId,
        datos: { totalCentavos, motivo, confirmadoSinPago: true },
        ip: actor.ip,
      });
      await notifyClient(
        tx,
        order,
        `Pedido #${order.numero} confirmado`,
        "Reactivamos tu pedido y no tiene importe a pagar: quedó confirmado.",
        "PEDIDO_CONFIRMADO",
      );
      return { venceEn: null, totalCentavos };
    }

    const venceEn = await cashReservationExpiry(tx, now);
    const reactivated = await transitionOrder(tx, {
      pedidoId,
      from: "VENCIDO",
      to: "RESERVADO",
      actorId: actor.id,
      motivo,
      at: now,
      data: { venceEn, subtotalProductosCentavos: pricing.totalCentavos, descuentoCuponCentavos: discount, totalCentavos },
    });
    if (!reactivated) throw new AppError("REACTIVACION_NO_PERMITIDA", "El pedido cambió de estado. Volvé a cargarlo.", 409);

    await tx.extensionReserva.create({
      data: { pedidoId, tipo: "REACTIVACION", venceEnAnterior: order.venceEn, venceEnNuevo: venceEn, motivo, autorId: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "RESERVA_REACTIVADA",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { venceEn: venceEn.toISOString(), totalCentavos, motivo },
      ip: actor.ip,
    });
    await notifyClient(
      tx,
      order,
      `Pedido #${order.numero}: reserva reactivada`,
      `Reactivamos tu reserva por ${(totalCentavos / 100).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}. Podés pagarla en el local hasta el ${dateFormat.format(venceEn)}.`,
      "RESERVA_REACTIVADA",
    );
    return { venceEn, totalCentavos };
  });
}
