import type { EstadoPedido, Prisma } from "@/generated/prisma/client";
import { AppError } from "@/server/shared/errors";
import { balanceDue } from "./order-balance";

/**
 * Transiciones válidas del pedido (sección 9.3), en una sola tabla. Cada etapa implementa
 * la operación que dispara una transición con sus propias guardas; esta tabla impide que
 * cualquier operación lleve el pedido a un estado no previsto.
 */
export const ORDER_TRANSITIONS: Record<EstadoPedido, readonly EstadoPedido[]> = {
  // Personalizados (INC-08.1): al aceptar la cotización; CONFIRMADO si el total final es $0 (RN-32).
  EN_DEFINICION: ["PENDIENTE_PAGO", "RESERVADO", "CONFIRMADO", "CANCELADO"],
  // Envío cotizado por la tienda (F-10): la cotización, y después el pago o el retiro.
  ENVIO_A_COTIZAR: ["ENVIO_COTIZADO", "CANCELADO"],
  // CONFIRMADO: el total final es $0 y no hay nada que cobrar (RN-32).
  ENVIO_COTIZADO: ["PENDIENTE_PAGO", "RESERVADO", "CONFIRMADO", "CANCELADO"],
  PENDIENTE_PAGO: ["CONFIRMADO", "VENCIDO", "CANCELADO"],
  RESERVADO: ["CONFIRMADO", "VENCIDO", "CANCELADO"],
  CONFIRMADO: ["EN_PRODUCCION", "LISTO_PARA_RETIRO", "DESPACHADO", "CANCELADO"],
  EN_PRODUCCION: ["LISTO_PARA_RETIRO", "DESPACHADO", "CANCELADO"],
  LISTO_PARA_RETIRO: ["ENTREGADO", "CANCELADO"],
  DESPACHADO: ["ENTREGADO"],
  ENTREGADO: [],
  CANCELADO: [],
  // Reactivación de una reserva vencida por el admin (RN-28); CONFIRMADO si el total final es $0 (RN-32).
  VENCIDO: ["RESERVADO", "CONFIRMADO"],
};

export function canTransition(from: EstadoPedido, to: EstadoPedido): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Cambia el estado solo si el pedido sigue en `from` (UPDATE condicional) y registra el historial.
 * Devuelve `false` si otro proceso ya lo cambió: el llamador decide qué responder.
 */
export async function transitionOrder(
  tx: Prisma.TransactionClient,
  {
    pedidoId,
    from,
    to,
    actorId,
    motivo,
    data,
    at,
  }: {
    pedidoId: string;
    from: EstadoPedido;
    to: EstadoPedido;
    actorId?: string | null;
    motivo?: string;
    data?: Prisma.PedidoUpdateManyMutationInput;
    /** Instante del historial; por defecto, el de la base. */
    at?: Date;
  },
): Promise<boolean> {
  if (!canTransition(from, to)) throw new Error(`Transición no prevista: ${from} → ${to}`);
  await assertDesignsApproved(tx, pedidoId, to);
  await assertBalancePaid(tx, pedidoId, to);
  const { count } = await tx.pedido.updateMany({ where: { id: pedidoId, estado: from }, data: { ...data, estado: to } });
  if (count === 0) return false;
  await tx.historialEstadoPedido.create({ data: { pedidoId, estadoAnterior: from, estadoNuevo: to, actorId, motivo, creadoEn: at } });
  return true;
}

/** Estados que exigen el pedido pagado por completo (RN-21, 9.3): con saldo pendiente no se despacha ni se entrega. */
const REQUIRES_FULL_PAYMENT: readonly EstadoPedido[] = ["DESPACHADO", "ENTREGADO"];

/**
 * Guarda del saldo pendiente. Vive en la transición para que ninguna operación la saltee: las de
 * despacho y entrega (INC-12) la heredan. En un estándar pagado el saldo es cero.
 */
async function assertBalancePaid(tx: Prisma.TransactionClient, pedidoId: string, to: EstadoPedido): Promise<void> {
  if (!REQUIRES_FULL_PAYMENT.includes(to)) return;
  const order = await tx.pedido.findUniqueOrThrow({ where: { id: pedidoId }, select: { id: true, totalCentavos: true } });
  const due = await balanceDue(tx, order);
  if (due > 0)
    throw new AppError("SALDO_PENDIENTE", "El pedido tiene saldo pendiente: no se puede despachar ni entregar.", 409, { saldoCentavos: due });
}

/** RN-07 (15.4): estados a los que un personalizado llega solo con todos sus diseños vigentes aprobados. */
const REQUIRES_APPROVED_DESIGNS: readonly EstadoPedido[] = ["EN_PRODUCCION", "LISTO_PARA_RETIRO", "DESPACHADO"];

/**
 * Guarda de RN-07, con el pedido ya bloqueado por quien llama. La fuente de verdad es que exista
 * una aprobación de la versión vigente de cada ítem, no el estado informativo del diseño. Una
 * reserva o un pago no la reemplazan (T-27). Las operaciones de INC-12 la heredan.
 */
async function assertDesignsApproved(tx: Prisma.TransactionClient, pedidoId: string, to: EstadoPedido): Promise<void> {
  if (!REQUIRES_APPROVED_DESIGNS.includes(to)) return;
  const order = await tx.pedido.findUniqueOrThrow({
    where: { id: pedidoId },
    select: { tipo: true, items: { select: { diseno: { select: { versionVigente: { select: { aprobacion: { select: { id: true } } } } } } } } },
  });
  if (order.tipo !== "PERSONALIZADO") return;
  const approved = order.items.length > 0 && order.items.every((item) => item.diseno?.versionVigente?.aprobacion);
  if (!approved) throw new AppError("DISENO_NO_APROBADO", "Falta la aprobación del cliente de la versión vigente del diseño.", 409);
}
