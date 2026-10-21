import { z } from "zod";
import type { ConceptoPago, EstadoPedido, MedioPago, Pedido, Prisma } from "@/generated/prisma/client";
import { formatPesos } from "@/lib/money";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { simulatedPaymentProvider, type PaymentProvider } from "@/server/modules/payments/payment-provider";
import { getConfig } from "@/server/shared/config";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { balanceDue } from "./order-balance";
import { CANCELLATION_CHARGE_PERCENT } from "./order.policy";
import { transitionOrder } from "./order-transitions";

type Tx = Prisma.TransactionClient;

const concept = z.enum(["TOTAL", "SENA", "SALDO"], "Concepto de pago inválido.");

const simulatedPaymentSchema = z.strictObject({
  /** Opcional: el servidor sabe qué corresponde cobrar; si se manda, tiene que coincidir. */
  concepto: concept.optional(),
  resultado: z.enum(["APROBADO", "RECHAZADO", "ERROR"]),
});

const cashPaymentSchema = z.strictObject({ concepto: concept.optional() });

/** El endpoint de pago simulado existe solo con `PAYMENTS_MODE=simulado` (T-48). */
export function assertSimulatedPaymentsEnabled(mode = getConfig().PAYMENTS_MODE): void {
  if (mode !== "simulado") throw new AppError("NO_ENCONTRADO", "No encontrado.", 404);
}

/** Bloquea la fila del pedido hasta el fin de la transacción: dos pagos simultáneos se procesan de a uno. */
export async function lockOrder(tx: Tx, pedidoId: string, where: Prisma.PedidoWhereInput = {}): Promise<Pedido> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(pedidoId);
  if (isUuid) await tx.$queryRaw`SELECT id FROM pedido WHERE id = ${pedidoId}::uuid FOR UPDATE`;
  const order = isUuid ? await tx.pedido.findFirst({ where: { id: pedidoId, ...where } }) : null;
  if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  return order;
}

/** RN-32: motivo del historial cuando el total final es $0 y el pedido se confirma sin pago. */
export const NO_PAYMENT_REQUIRED = "SIN_PAGO_REQUERIDO";

/** Lo que fija toda confirmación sin pago (RN-32): el porcentaje del cargo (RN-15) y ningún plazo de pago. */
export function confirmationWithoutPaymentData() {
  return { porcentajeCargoCancelacion: CANCELLATION_CHARGE_PERCENT, venceEn: null };
}

/** El plazo se controla al pagar, no depende de que haya corrido el proceso de vencimiento (14.5). */
function assertAwaitingPayment(order: Pedido, expected: EstadoPedido, expiredCode: string): void {
  if (order.estado !== expected) {
    throw new AppError("PEDIDO_NO_PAGABLE", "Este pedido no está esperando un pago.", 409, { estado: order.estado });
  }
  if (!order.venceEn || order.venceEn <= new Date()) {
    throw new AppError(expiredCode, "El plazo para pagar este pedido venció.", 409);
  }
}

/** RN-21: estados en los que se cobra el saldo. Con envío, antes del despacho; en efectivo, solo al retirar. */
const BALANCE_STATES: Record<MedioPago, Record<"RETIRO" | "ENVIO", readonly EstadoPedido[]>> = {
  ONLINE: { RETIRO: ["CONFIRMADO", "EN_PRODUCCION", "LISTO_PARA_RETIRO"], ENVIO: ["CONFIRMADO", "EN_PRODUCCION"] },
  EFECTIVO: { RETIRO: ["LISTO_PARA_RETIRO"], ENVIO: [] },
};

type Charge = { concepto: ConceptoPago; importeCentavos: number; confirma: boolean };

/**
 * Qué se cobra y cuánto, decidido en el servidor con el pedido bloqueado (RN-16, RN-21, RN-22):
 * estándar, el total; personalizado pendiente, la seña dentro del plazo; personalizado
 * confirmado, el saldo (total − lo cobrado), sin plazo ni cambio de estado.
 */
async function chargeFor(tx: Tx, order: Pedido, medio: MedioPago, requested?: ConceptoPago): Promise<Charge> {
  // RN-32: nunca se cobra ni se registra un pago de $0.
  if (order.totalCentavos <= 0) throw new AppError("SIN_PAGO_REQUERIDO", "Este pedido no tiene importe a pagar.", 409);
  const pendingState = medio === "ONLINE" ? "PENDIENTE_PAGO" : "RESERVADO";
  const expiredCode = medio === "ONLINE" ? "PAGO_VENCIDO" : "RESERVA_VENCIDA";

  let charge: Charge;
  if (order.tipo === "ESTANDAR") {
    assertAwaitingPayment(order, pendingState, expiredCode);
    charge = { concepto: "TOTAL", importeCentavos: order.totalCentavos, confirma: true };
  } else if (order.estado === "PENDIENTE_PAGO" || order.estado === "RESERVADO") {
    assertAwaitingPayment(order, pendingState, expiredCode);
    if (!order.senaCentavos) throw new AppError("PEDIDO_NO_PAGABLE", "Este pedido no tiene una seña a pagar.", 409);
    charge = { concepto: "SENA", importeCentavos: order.senaCentavos, confirma: true };
  } else {
    if (!BALANCE_STATES[medio][order.modalidadEntrega].includes(order.estado)) {
      const message = medio === "EFECTIVO" ? "El saldo en efectivo se paga al retirar." : "Este pedido no está esperando un pago.";
      throw new AppError("PEDIDO_NO_PAGABLE", message, 409, { estado: order.estado });
    }
    const due = await balanceDue(tx, order);
    if (due === 0) throw new AppError("SALDO_YA_PAGADO", "El pedido ya está pagado.", 409);
    charge = { concepto: "SALDO", importeCentavos: due, confirma: false };
  }
  if (requested && requested !== charge.concepto) {
    throw new AppError("CONCEPTO_INVALIDO", "Ese concepto no corresponde a este pedido.", 409, { concepto: charge.concepto });
  }
  return charge;
}

/** RN-16: el pedido queda confirmado cuando tiene un pago registrado. */
async function confirm(tx: Tx, order: Pedido, actorId: string, clientEmail: string): Promise<void> {
  const confirmed = await transitionOrder(tx, {
    pedidoId: order.id,
    from: order.estado,
    to: "CONFIRMADO",
    actorId,
    data: { porcentajeCargoCancelacion: CANCELLATION_CHARGE_PERCENT },
  });
  if (!confirmed) throw new AppError("PEDIDO_NO_PAGABLE", "Este pedido no está esperando un pago.", 409);
  await enqueueNotification(tx, {
    usuarioId: order.clienteId,
    email: clientEmail,
    tipo: "PEDIDO_CONFIRMADO",
    titulo: `Pedido #${order.numero} confirmado`,
    mensaje:
      order.tipo === "PERSONALIZADO"
        ? `Registramos la seña. El saldo de ${formatPesos(order.totalCentavos - (order.senaCentavos ?? 0))} se paga ${order.modalidadEntrega === "ENVIO" ? "online antes del despacho" : "online o al retirar"}.`
        : "Registramos el pago. Te avisamos cuando el pedido esté listo para retirar.",
  });
}

/** Pago online simulado de un pedido propio (RF-46 a RF-48). Los rechazos también se registran. */
export async function paySimulated(
  user: SessionUser,
  pedidoId: string,
  input: unknown,
  { db = getDb(), provider = simulatedPaymentProvider }: { db?: Db; provider?: PaymentProvider } = {},
) {
  assertSimulatedPaymentsEnabled();
  const { concepto, resultado } = simulatedPaymentSchema.parse(input);

  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId, { clienteId: user.id });
    const due = await chargeFor(tx, order, "ONLINE", concepto);

    const charge = await provider.charge({ pedidoId, importeCentavos: due.importeCentavos, resultadoForzado: resultado });
    const payment = await tx.pago.create({
      data: {
        pedidoId,
        concepto: due.concepto,
        medio: "ONLINE",
        proveedor: provider.name,
        simulado: provider.simulated,
        estado: charge.estado,
        importeCentavos: due.importeCentavos,
        referenciaExterna: charge.referencia,
      },
    });
    await recordAudit(tx, {
      actorId: user.id,
      accion: charge.estado === "APROBADO" ? "PAGO_APROBADO" : "PAGO_NO_APROBADO",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: {
        pagoId: payment.id,
        concepto: due.concepto,
        estado: charge.estado,
        importeCentavos: due.importeCentavos,
        simulado: provider.simulated,
      },
    });
    const approved = charge.estado === "APROBADO";
    if (approved && due.confirma) await confirm(tx, order, user.id, user.email);
    return { pago: payment, confirmado: approved && due.confirma };
  });
}

/** El administrador registra el efectivo de una reserva vigente (RF-19). */
export async function registerCashPayment(actor: Actor, pedidoId: string, input: unknown = {}, db: Db = getDb()) {
  const { concepto } = cashPaymentSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);
    const due = await chargeFor(tx, order, "EFECTIVO", concepto);

    const payment = await tx.pago.create({
      data: {
        pedidoId,
        concepto: due.concepto,
        medio: "EFECTIVO",
        simulado: false,
        estado: "APROBADO",
        importeCentavos: due.importeCentavos,
        registradoPorId: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "PAGO_EFECTIVO_REGISTRADO",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { pagoId: payment.id, concepto: due.concepto, importeCentavos: due.importeCentavos },
      ip: actor.ip,
    });
    if (due.confirma) {
      const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
      await confirm(tx, order, actor.id, client.email);
    }
    return { pago: payment };
  });
}
