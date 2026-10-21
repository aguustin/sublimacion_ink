import { z } from "zod";
import type { EstadoPedido, Pedido, Prisma } from "@/generated/prisma/client";
import { formatPesos } from "@/lib/money";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { applyCancellation, evaluateForShippingDecline } from "@/server/modules/cancellations/cancellation.service";
import { reserveStock } from "@/server/modules/inventory/stock-retention.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { contactSentence, getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { retryAfterExpiringOverdue } from "./expiration.service";
import { cashReservationExpiry } from "./holidays.service";
import { confirmationWithoutPaymentData, lockOrder, NO_PAYMENT_REQUIRED } from "./order-payment.service";
import { applyCurrentPrices, assertPurchasable, currentCouponDiscount, findOrderWithItems, priceAtCurrentRates } from "./order-pricing";
import { onlinePaymentExpiry, shippingQuoteStepExpiry } from "./order.policy";
import { transitionOrder } from "./order-transitions";

// Envío cotizado por la tienda (F-10, D-06 opción B, D-45 a D-47, D-49). El pedido no retiene
// stock mientras se cotiza; lo retiene al aceptar la cotización o al pasar a retiro.

type Tx = Prisma.TransactionClient;

const reason = z.string().trim().min(3, "Indicá el motivo.").max(500);

const quoteSchema = z.discriminatedUnion("envioPosible", [
  z.strictObject({
    envioPosible: z.literal(true),
    importeCentavos: z.number().int().min(0, "El costo no puede ser negativo.").max(100_000_000),
    nota: z.string().trim().max(500).optional(),
  }),
  /** D-49: la tienda no puede enviar a esa dirección. */
  z.strictObject({ envioPosible: z.literal(false), nota: reason }),
]);

const acceptSchema = z.strictObject({
  cotizacionId: z.uuid(),
  /** Total que el cliente vio (productos a precio vigente + envío): si cambió, se rechaza (RN-27). */
  totalEsperadoCentavos: z.number().int().min(0),
});

const pickupSchema = z.strictObject({
  modalidadCierre: z.enum(["ONLINE", "EFECTIVO"], "Elegí cómo vas a pagar."),
  totalEsperadoCentavos: z.number().int().min(0),
});

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** El plazo se controla al actuar, no depende de que haya corrido el proceso de vencimiento (D-46). */
function assertOpen(order: Pedido, estados: EstadoPedido[]): void {
  if (!estados.includes(order.estado)) {
    throw new AppError("ESTADO_INVALIDO", "El pedido no está esperando la cotización del envío.", 409, { estado: order.estado });
  }
  if (!order.venceEn || order.venceEn <= new Date()) {
    throw new AppError("PLAZO_VENCIDO", "El plazo de la cotización del envío venció.", 409);
  }
}

function currentQuote(db: DbClient, pedidoId: string) {
  return db.cotizacionEnvio.findFirst({ where: { pedidoId, estado: "PROPUESTA" }, orderBy: { creadoEn: "desc" } });
}

async function notifyClient(tx: Tx, order: Pedido, tipo: string, titulo: string, mensaje: string) {
  const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
  await enqueueNotification(tx, { usuarioId: order.clienteId, email: client.email, tipo, titulo, mensaje });
}

/**
 * La tienda cotiza el envío, o indica que no puede enviar (D-49). Una corrección reemplaza la
 * cotización anterior y le da al cliente un nuevo plazo de 48 h para responder (D-46).
 */
export async function quoteShipping(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const data = quoteSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);
    assertOpen(order, ["ENVIO_A_COTIZAR", "ENVIO_COTIZADO"]);

    const now = new Date();
    const venceEn = shippingQuoteStepExpiry(now);
    await tx.cotizacionEnvio.updateMany({ where: { pedidoId, estado: "PROPUESTA" }, data: { estado: "REEMPLAZADA", respondidaEn: now } });
    const quote = await tx.cotizacionEnvio.create({
      data: { pedidoId, importeCentavos: data.envioPosible ? data.importeCentavos : null, nota: data.nota || null, autorId: actor.id, creadoEn: now },
    });
    if (order.estado === "ENVIO_A_COTIZAR") {
      await transitionOrder(tx, { pedidoId, from: "ENVIO_A_COTIZAR", to: "ENVIO_COTIZADO", actorId: actor.id, at: now, data: { venceEn } });
    } else {
      await tx.pedido.updateMany({ where: { id: pedidoId, estado: "ENVIO_COTIZADO" }, data: { venceEn } });
    }

    await recordAudit(tx, {
      actorId: actor.id,
      accion: data.envioPosible ? "ENVIO_COTIZADO" : "ENVIO_NO_POSIBLE",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { cotizacionId: quote.id, importeCentavos: quote.importeCentavos, nota: quote.nota, reemplaza: order.estado === "ENVIO_COTIZADO" },
      ip: actor.ip,
    });
    const deadline = dateFormat.format(venceEn);
    await notifyClient(
      tx,
      order,
      data.envioPosible ? "ENVIO_COTIZADO" : "ENVIO_NO_POSIBLE",
      `Pedido #${order.numero}: ${data.envioPosible ? "costo del envío" : "no podemos enviarlo"}`,
      data.envioPosible
        ? `El envío cuesta ${formatPesos(data.importeCentavos)}. Hasta el ${deadline} podés aceptarlo y pagar online, pasar a retiro en el local o cancelar sin cargo.`
        : `No podemos enviar el pedido a tu dirección (${data.nota}). Hasta el ${deadline} podés pasar a retiro en el local o cancelar el pedido sin cargo.`,
    );
    return { cotizacion: quote, venceEn };
  });
}

/** Lo que el cliente ve para responder: cotización vigente y total a precios de hoy (RN-27). */
export async function getShippingQuoteView(clienteId: string, pedidoId: string, db: Db = getDb()) {
  const order = await findOrderWithItems(db, pedidoId, { clienteId });
  const quote = await currentQuote(db, pedidoId);
  const pricing = priceAtCurrentRates(order);
  const discount = await currentCouponDiscount(db, order, pricing.totalCentavos);
  return {
    cotizacion: quote,
    productos: pricing.items,
    subtotalProductosCentavos: pricing.totalCentavos,
    descuentoCuponCentavos: discount,
    costoEnvioCentavos: quote?.importeCentavos ?? null,
    totalCentavos: pricing.totalCentavos - discount + (quote?.importeCentavos ?? 0),
    /** Con productos a la venta y stock disponible hoy; la retención real se hace al responder (D-45). */
    hayStock: pricing.puedeReactivarse,
  };
}

type PaymentStart = {
  modalidadCierre: "ONLINE" | "EFECTIVO";
  modalidadEntrega: "ENVIO" | "RETIRO";
  costoEnvioCentavos: number;
  totalEsperadoCentavos: number;
  motivo: string;
};

/**
 * Pasa el pedido cotizado a pago: precios vigentes, retención atómica de todos los ítems (14.3,
 * D-45; sin stock no cambia nada) y el plazo de pago de la modalidad elegida (RN-22, RN-29).
 */
async function startPayment(tx: Tx, user: SessionUser, pedidoId: string, start: PaymentStart) {
  const order = await findOrderWithItems(tx, pedidoId);
  const pricing = priceAtCurrentRates(order);
  assertPurchasable(pricing);
  // RN-20: el cupón descuenta sobre los productos a precio vigente, nunca sobre el envío.
  const discount = await currentCouponDiscount(tx, order, pricing.totalCentavos);
  const totalCentavos = pricing.totalCentavos - discount + start.costoEnvioCentavos;
  if (totalCentavos !== start.totalEsperadoCentavos) {
    throw new AppError("PRECIO_CAMBIADO", "El total cambió. Revisá el nuevo total antes de confirmar.", 409, {
      subtotalProductosCentavos: pricing.totalCentavos,
      descuentoCuponCentavos: discount,
      costoEnvioCentavos: start.costoEnvioCentavos,
      totalCentavos,
    });
  }

  const now = new Date();
  await reserveStock(
    tx,
    pedidoId,
    order.items.map(({ varianteId, cantidad }) => ({ varianteId, cantidad })),
  );
  await applyCurrentPrices(tx, pricing);

  const online = start.modalidadCierre === "ONLINE";
  // RN-32: con el total final completo (productos − cupón + envío) en $0, se confirma sin pago.
  const free = totalCentavos === 0;
  const estado = free ? "CONFIRMADO" : online ? "PENDIENTE_PAGO" : "RESERVADO";
  const venceEn = free ? null : online ? onlinePaymentExpiry(now) : await cashReservationExpiry(tx, now);
  // `at`: el recálculo por feriados parte del instante en que empezó la reserva (RN-29).
  const started = await transitionOrder(tx, {
    pedidoId,
    from: "ENVIO_COTIZADO",
    to: estado,
    actorId: user.id,
    motivo: free ? NO_PAYMENT_REQUIRED : start.motivo,
    at: now,
    data: {
      modalidadCierre: start.modalidadCierre,
      modalidadEntrega: start.modalidadEntrega,
      ...(free ? confirmationWithoutPaymentData() : { venceEn }),
      subtotalProductosCentavos: pricing.totalCentavos,
      descuentoCuponCentavos: discount,
      costoEnvioCentavos: start.costoEnvioCentavos,
      totalCentavos,
    },
  });
  if (!started) throw new AppError("ESTADO_INVALIDO", "El pedido cambió de estado. Volvé a cargarlo.", 409);

  if (free) {
    await notifyClient(tx, order, "PEDIDO_CONFIRMADO", `Pedido #${order.numero} confirmado`, "Tu pedido no tiene importe a pagar: quedó confirmado.");
  } else {
    await notifyClient(
      tx,
      order,
      online ? "PEDIDO_PENDIENTE_PAGO" : "RESERVA_CREADA",
      `Pedido #${order.numero}: ${online ? "pendiente de pago" : "reservado"}`,
      online
        ? `Completá el pago de ${formatPesos(totalCentavos)} antes del ${dateFormat.format(venceEn!)}; después el pedido vence.`
        : `Reservamos tu pedido. Pagalo en efectivo en el local antes del ${dateFormat.format(venceEn!)}; después la reserva vence.${contactSentence(await getStoreContact(tx))}`,
    );
  }
  return { estado, venceEn, totalCentavos };
}

/** El cliente acepta la cotización vigente y pasa a pagar online (F-10, RN-13). */
export async function acceptShippingQuote(user: SessionUser, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { cotizacionId, totalEsperadoCentavos } = acceptSchema.parse(input);
  return retryAfterExpiringOverdue(db, () =>
    db.$transaction(async (tx) => {
      const order = await lockOrder(tx, pedidoId, { clienteId: user.id });
      assertOpen(order, ["ENVIO_COTIZADO"]);
      const quote = await currentQuote(tx, pedidoId);
      if (!quote || quote.id !== cotizacionId) {
        throw new AppError("COTIZACION_DESACTUALIZADA", "La tienda cambió la cotización del envío. Revisala antes de aceptar.", 409);
      }
      if (quote.importeCentavos === null) {
        throw new AppError("ENVIO_NO_POSIBLE", "La tienda no puede enviar a tu dirección: pasá a retiro en el local o cancelá el pedido.", 409);
      }

      const result = await startPayment(tx, user, pedidoId, {
        modalidadCierre: "ONLINE",
        modalidadEntrega: "ENVIO",
        costoEnvioCentavos: quote.importeCentavos,
        totalEsperadoCentavos,
        motivo: "COTIZACION_ENVIO_ACEPTADA",
      });
      await tx.cotizacionEnvio.update({ where: { id: quote.id }, data: { estado: "ACEPTADA", respondidaEn: new Date() } });
      await recordAudit(tx, {
        actorId: user.id,
        accion: "ENVIO_ACEPTADO",
        entidad: "pedido",
        entidadId: pedidoId,
        datos: { cotizacionId: quote.id, totalCentavos: result.totalCentavos },
      });
      return result;
    }),
  );
}

/** D-47: en lugar del envío, el cliente pasa a retiro en el local, con pago online o efectivo (RN-13). */
export async function switchToPickup(user: SessionUser, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { modalidadCierre, totalEsperadoCentavos } = pickupSchema.parse(input);
  if (modalidadCierre === "EFECTIVO" && !user.telefono) {
    throw new AppError("TELEFONO_REQUERIDO", "Para reservar con pago en efectivo necesitamos tu teléfono.", 422);
  }
  return retryAfterExpiringOverdue(db, () =>
    db.$transaction(async (tx) => {
      const order = await lockOrder(tx, pedidoId, { clienteId: user.id });
      assertOpen(order, ["ENVIO_COTIZADO"]);
      const quote = await currentQuote(tx, pedidoId);

      const result = await startPayment(tx, user, pedidoId, {
        modalidadCierre,
        modalidadEntrega: "RETIRO",
        costoEnvioCentavos: 0,
        totalEsperadoCentavos,
        motivo: "CAMBIO_A_RETIRO",
      });
      if (quote) await tx.cotizacionEnvio.update({ where: { id: quote.id }, data: { estado: "RECHAZADA", respondidaEn: new Date() } });
      // D-49: si el pedido sigue con retiro, no corresponde cupón aunque la tienda no pudiera enviar.
      await recordAudit(tx, {
        actorId: user.id,
        accion: "ENVIO_CAMBIADO_A_RETIRO",
        entidad: "pedido",
        entidadId: pedidoId,
        datos: { cotizacionId: quote?.id ?? null, modalidadCierre, totalCentavos: result.totalCentavos },
      });
      return result;
    }),
  );
}

/**
 * El cliente no acepta el envío y cancela, sin cargo porque todavía no pagó (D-47). Si la tienda
 * había indicado que no puede enviar, es una cancelación por la tienda y corresponde el cupón de
 * compensación (D-49, RN-19, RN-20); el cupón lo emite el módulo de cupones (INC-11).
 */
export async function declineShipping(user: SessionUser, pedidoId: string, db: Db = getDb()) {
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId, { clienteId: user.id });
    assertOpen(order, ["ENVIO_COTIZADO"]);
    const quote = await currentQuote(tx, pedidoId);
    const storeCannotShip = quote !== null && quote.importeCentavos === null;
    const causa = storeCannotShip ? "ENVIO_NO_POSIBLE" : "COSTO_ENVIO_RECHAZADO";

    const rol = storeCannotShip ? "TIENDA" : "CLIENTE";
    const decision = await evaluateForShippingDecline(tx, order, rol);

    if (quote) await tx.cotizacionEnvio.update({ where: { id: quote.id }, data: { estado: "RECHAZADA", respondidaEn: new Date() } });
    await applyCancellation(tx, order, {
      rol,
      actor: { id: user.id },
      motivo: storeCannotShip
        ? `La tienda no puede enviar a la dirección${quote?.nota ? `: ${quote.nota}` : ""}`
        : "El cliente rechazó el costo del envío",
      motivoHistorial: causa,
      decision,
    });
    return { estado: "CANCELADO" as const, causa };
  });
}
