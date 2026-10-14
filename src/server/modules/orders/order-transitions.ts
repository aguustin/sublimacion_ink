import type { EstadoPedido, Prisma } from "@/generated/prisma/client";

/**
 * Transiciones válidas del pedido (sección 9.3), en una sola tabla. Cada etapa implementa
 * la operación que dispara una transición con sus propias guardas; esta tabla impide que
 * cualquier operación lleve el pedido a un estado no previsto.
 */
export const ORDER_TRANSITIONS: Record<EstadoPedido, readonly EstadoPedido[]> = {
  EN_DEFINICION: ["PENDIENTE_PAGO", "RESERVADO", "CANCELADO"],
  PENDIENTE_PAGO: ["CONFIRMADO", "VENCIDO", "CANCELADO"],
  RESERVADO: ["CONFIRMADO", "VENCIDO", "CANCELADO"],
  CONFIRMADO: ["EN_PRODUCCION", "LISTO_PARA_RETIRO", "DESPACHADO", "CANCELADO"],
  EN_PRODUCCION: ["LISTO_PARA_RETIRO", "DESPACHADO", "CANCELADO"],
  LISTO_PARA_RETIRO: ["ENTREGADO", "CANCELADO"],
  DESPACHADO: ["ENTREGADO"],
  ENTREGADO: [],
  CANCELADO: [],
  // La reactivación de una reserva vencida (RN-28) se agrega en INC-06.3.
  VENCIDO: [],
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
  }: {
    pedidoId: string;
    from: EstadoPedido;
    to: EstadoPedido;
    actorId?: string | null;
    motivo?: string;
    data?: Prisma.PedidoUpdateManyMutationInput;
  },
): Promise<boolean> {
  if (!canTransition(from, to)) throw new Error(`Transición no prevista: ${from} → ${to}`);
  const { count } = await tx.pedido.updateMany({ where: { id: pedidoId, estado: from }, data: { ...data, estado: to } });
  if (count === 0) return false;
  await tx.historialEstadoPedido.create({ data: { pedidoId, estadoAnterior: from, estadoNuevo: to, actorId, motivo } });
  return true;
}
