import { z } from "zod";
import type { EstadoPedido, Pedido, Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { simulatedPaymentProvider, type PaymentProvider } from "@/server/modules/payments/payment-provider";
import { getConfig } from "@/server/shared/config";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { CANCELLATION_CHARGE_PERCENT } from "./order.policy";
import { transitionOrder } from "./order-transitions";

type Tx = Prisma.TransactionClient;

const simulatedPaymentSchema = z.strictObject({
  concepto: z.literal("TOTAL").default("TOTAL"),
  resultado: z.enum(["APROBADO", "RECHAZADO", "ERROR"]),
});

/** El endpoint de pago simulado existe solo con `PAYMENTS_MODE=simulado` (T-48). */
export function assertSimulatedPaymentsEnabled(mode = getConfig().PAYMENTS_MODE): void {
  if (mode !== "simulado") throw new AppError("NO_ENCONTRADO", "No encontrado.", 404);
}

/** Bloquea la fila del pedido hasta el fin de la transacción: dos pagos simultáneos se procesan de a uno. */
async function lockOrder(tx: Tx, pedidoId: string, where: Prisma.PedidoWhereInput = {}): Promise<Pedido> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(pedidoId);
  if (isUuid) await tx.$queryRaw`SELECT id FROM pedido WHERE id = ${pedidoId}::uuid FOR UPDATE`;
  const order = isUuid ? await tx.pedido.findFirst({ where: { id: pedidoId, ...where } }) : null;
  if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  return order;
}

/** El plazo se controla al pagar, no depende de que haya corrido el proceso de vencimiento (14.5). */
function assertPayable(order: Pedido, expected: EstadoPedido, expiredCode: string): void {
  if (order.estado !== expected) {
    throw new AppError("PEDIDO_NO_PAGABLE", "Este pedido no está esperando un pago.", 409, { estado: order.estado });
  }
  if (!order.venceEn || order.venceEn <= new Date()) {
    throw new AppError(expiredCode, "El plazo para pagar este pedido venció.", 409);
  }
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
    mensaje: "Registramos el pago. Te avisamos cuando el pedido esté listo para retirar.",
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
    assertPayable(order, "PENDIENTE_PAGO", "PAGO_VENCIDO");

    const charge = await provider.charge({ pedidoId, importeCentavos: order.totalCentavos, resultadoForzado: resultado });
    const payment = await tx.pago.create({
      data: {
        pedidoId,
        concepto,
        medio: "ONLINE",
        proveedor: provider.name,
        simulado: provider.simulated,
        estado: charge.estado,
        importeCentavos: order.totalCentavos,
        referenciaExterna: charge.referencia,
      },
    });
    await recordAudit(tx, {
      actorId: user.id,
      accion: charge.estado === "APROBADO" ? "PAGO_APROBADO" : "PAGO_NO_APROBADO",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { pagoId: payment.id, estado: charge.estado, importeCentavos: order.totalCentavos, simulado: provider.simulated },
    });
    if (charge.estado === "APROBADO") await confirm(tx, order, user.id, user.email);
    return { pago: payment, confirmado: charge.estado === "APROBADO" };
  });
}

/** El administrador registra el efectivo de una reserva vigente (RF-19). */
export async function registerCashPayment(actor: Actor, pedidoId: string, db: Db = getDb()) {
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);
    assertPayable(order, "RESERVADO", "RESERVA_VENCIDA");

    const payment = await tx.pago.create({
      data: {
        pedidoId,
        concepto: "TOTAL",
        medio: "EFECTIVO",
        simulado: false,
        estado: "APROBADO",
        importeCentavos: order.totalCentavos,
        registradoPorId: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "PAGO_EFECTIVO_REGISTRADO",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { pagoId: payment.id, importeCentavos: order.totalCentavos },
      ip: actor.ip,
    });
    const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
    await confirm(tx, order, actor.id, client.email);
    return { pago: payment };
  });
}
