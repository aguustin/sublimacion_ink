import type { DbClient } from "@/server/shared/db";

// Saldo de un pedido (RN-21): lo que falta cobrar del total final. Se calcula siempre con los pagos
// aprobados guardados, nunca con importes que mande el cliente, y no se guarda aparte.

export async function approvedPaymentsTotal(db: DbClient, pedidoId: string): Promise<number> {
  const { _sum } = await db.pago.aggregate({ where: { pedidoId, estado: "APROBADO" }, _sum: { importeCentavos: true } });
  return _sum.importeCentavos ?? 0;
}

/** Total final (productos − cupón + envío) menos lo ya cobrado; en un personalizado con seña, el saldo. */
export async function balanceDue(db: DbClient, order: { id: string; totalCentavos: number }): Promise<number> {
  return Math.max(0, order.totalCentavos - (await approvedPaymentsTotal(db, order.id)));
}
