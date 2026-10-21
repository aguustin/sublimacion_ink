import type { EstadoPedido, MotivoLiberacion, Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/modules/audit/audit.service";
import { restoreCoupon } from "@/server/modules/coupons/coupon.service";
import { releaseOrderRetentions } from "@/server/modules/inventory/stock-retention.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { contactSentence, getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { logger } from "@/server/shared/logger";
import { transitionOrder } from "./order-transitions";

// Vencimientos (sección 14.5, RN-06, RN-22, D-46): mecanismos independientes, cada uno con su
// estado de origen, su motivo y su aviso. Ninguno toca los pedidos del otro.

type Expiration = {
  estado: Extract<EstadoPedido, "PENDIENTE_PAGO" | "RESERVADO" | "ENVIO_A_COTIZAR" | "ENVIO_COTIZADO">;
  destino: Extract<EstadoPedido, "VENCIDO" | "CANCELADO">;
  motivo: string;
  /** Motivo de liberación del stock retenido; nulo si el estado no retiene stock (D-45). */
  liberacion: MotivoLiberacion | null;
  tipoAviso: string;
  aviso: (numero: number) => string;
};

const ONLINE_PAYMENT: Expiration = {
  estado: "PENDIENTE_PAGO",
  destino: "VENCIDO",
  motivo: "VENCIMIENTO_PAGO_ONLINE",
  liberacion: "VENCIMIENTO_PAGO_ONLINE",
  tipoAviso: "PAGO_VENCIDO",
  aviso: (numero) => `El pago del pedido #${numero} no se completó a tiempo y el pedido venció. Podés volver a comprar si todavía hay stock.`,
};

const CASH_RESERVATION: Expiration = {
  estado: "RESERVADO",
  destino: "VENCIDO",
  motivo: "VENCIMIENTO_RESERVA",
  liberacion: "VENCIMIENTO_RESERVA",
  tipoAviso: "RESERVA_VENCIDA",
  aviso: (numero) => `La reserva del pedido #${numero} venció porque no se registró el pago en el local.`,
};

// D-46: si la tienda no cotiza o el cliente no responde en 48 h, el pedido se cancela, sin cupón.
const SHIPPING_QUOTE_PENDING: Expiration = {
  estado: "ENVIO_A_COTIZAR",
  destino: "CANCELADO",
  motivo: "PLAZO_COTIZACION_ENVIO",
  liberacion: null,
  tipoAviso: "PEDIDO_CANCELADO",
  aviso: (numero) => `Cancelamos el pedido #${numero} porque no pudimos cotizar el envío a tiempo. No se te cobró nada.`,
};

const SHIPPING_QUOTE_UNANSWERED: Expiration = {
  estado: "ENVIO_COTIZADO",
  destino: "CANCELADO",
  motivo: "PLAZO_RESPUESTA_ENVIO",
  liberacion: null,
  tipoAviso: "PEDIDO_CANCELADO",
  aviso: (numero) => `Cancelamos el pedido #${numero} porque no respondiste la cotización del envío a tiempo. No se te cobró nada.`,
};

const BY_STATE = { PENDIENTE_PAGO: ONLINE_PAYMENT, RESERVADO: CASH_RESERVATION } as const;

const BATCH_SIZE = 100;

export type ExpirationResult = { revisados: number; vencidos: number };

/** Proceso de pagos online pendientes: cada 1 minuto (RN-22). */
export function expireOnlinePayments(db: Db = getDb()): Promise<ExpirationResult> {
  return expireBatch(db, ONLINE_PAYMENT);
}

/** Proceso de reservas en efectivo impagas: cada 5 minutos (RN-06). */
export function expireCashReservations(db: Db = getDb()): Promise<ExpirationResult> {
  return expireBatch(db, CASH_RESERVATION);
}

/** Proceso de los plazos del envío cotizado: cada 15 minutos (D-46). */
export async function expireShippingQuotes(db: Db = getDb()): Promise<ExpirationResult> {
  const pending = await expireBatch(db, SHIPPING_QUOTE_PENDING);
  const unanswered = await expireBatch(db, SHIPPING_QUOTE_UNANSWERED);
  return { revisados: pending.revisados + unanswered.revisados, vencidos: pending.vencidos + unanswered.vencidos };
}

async function expireBatch(db: Db, kind: Expiration): Promise<ExpirationResult> {
  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM pedido
    WHERE estado = ${kind.estado}::"EstadoPedido" AND vence_en <= now()
    ORDER BY vence_en
    LIMIT ${BATCH_SIZE}`;

  let vencidos = 0;
  // Cada pedido en su propia transacción: un fallo no deshace los ya vencidos, y el resto
  // se toma en la próxima ejecución.
  for (const { id } of candidates) {
    try {
      if (await db.$transaction((tx) => expireOrder(tx, id, kind))) vencidos++;
    } catch (error) {
      logger.error({ err: error, pedidoId: id }, "no se pudo vencer el pedido");
    }
  }
  if (vencidos > 0) logger.info({ estado: kind.estado, vencidos }, "pedidos vencidos");
  return { revisados: candidates.length, vencidos };
}

/**
 * Vence un pedido y libera su stock una sola vez. `SKIP LOCKED`: si otra ejecución o un pago lo
 * está procesando, se saltea. La condición de estado y fecha se vuelve a comprobar con la fila
 * bloqueada, así que un pedido que se pagó a tiempo nunca vence.
 */
async function expireOrder(tx: Prisma.TransactionClient, pedidoId: string, kind: Expiration): Promise<boolean> {
  const [order] = await tx.$queryRaw<{ numero: number; cliente_id: string }[]>`
    SELECT numero, cliente_id FROM pedido
    WHERE id = ${pedidoId}::uuid AND estado = ${kind.estado}::"EstadoPedido" AND vence_en <= now()
    FOR UPDATE SKIP LOCKED`;
  if (!order) return false;

  await transitionOrder(tx, { pedidoId, from: kind.estado, to: kind.destino, motivo: kind.motivo });
  const liberadas = kind.liberacion ? await releaseOrderRetentions(tx, pedidoId, kind.liberacion) : 0;
  // RN-20: el cupón usado vuelve a estar activo una sola vez, con su vencimiento original.
  await restoreCoupon(tx, pedidoId);
  await recordAudit(tx, {
    accion: kind.destino === "VENCIDO" ? "PEDIDO_VENCIDO" : "PEDIDO_CANCELADO",
    entidad: "pedido",
    entidadId: pedidoId,
    datos: { motivo: kind.motivo, liberadas },
  });

  const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.cliente_id }, select: { email: true } });
  const contact = kind === CASH_RESERVATION ? contactSentence(await getStoreContact(tx)) : "";
  await enqueueNotification(tx, {
    usuarioId: order.cliente_id,
    email: client.email,
    tipo: kind.tipoAviso,
    titulo: `Pedido #${order.numero} ${kind.destino === "VENCIDO" ? "vencido" : "cancelado"}`,
    mensaje: kind.aviso(order.numero) + contact,
  });
  return true;
}

/**
 * Vencimiento oportunista (14.5): si falta stock de una variante, antes de rechazar la compra
 * se vencen los pedidos ya vencidos que la retienen, por si el proceso periódico se atrasó.
 */
export async function expireOverdueOrdersHolding(varianteId: string, db: Db = getDb()): Promise<number> {
  const overdue = await db.$queryRaw<{ id: string; estado: "PENDIENTE_PAGO" | "RESERVADO" }[]>`
    SELECT DISTINCT p.id, p.estado::text AS estado
    FROM pedido p JOIN retencion_stock r ON r.pedido_id = p.id
    WHERE r.variante_id = ${varianteId}::uuid AND r.estado = 'ACTIVA'
      AND p.estado IN ('PENDIENTE_PAGO', 'RESERVADO') AND p.vence_en <= now()`;
  let vencidos = 0;
  for (const { id, estado } of overdue) {
    if (await db.$transaction((tx) => expireOrder(tx, id, BY_STATE[estado]))) vencidos++;
  }
  return vencidos;
}

/**
 * Igual que en el checkout (14.5): si una operación falla por falta de stock que retiene un pedido
 * ya vencido, se vence ese pedido y se reintenta una sola vez.
 */
export async function retryAfterExpiringOverdue<T>(db: Db, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const varianteId =
      error instanceof AppError && error.code === "STOCK_INSUFICIENTE"
        ? (error.details as { varianteId?: string } | undefined)?.varianteId
        : undefined;
    if (varianteId && (await expireOverdueOrdersHolding(varianteId, db)) > 0) return operation();
    throw error;
  }
}
