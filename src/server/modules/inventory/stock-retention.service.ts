import type { MotivoLiberacion, Prisma, RetencionStock } from "@/generated/prisma/client";
import { AppError } from "@/server/shared/errors";
import { stockItemsSchema } from "./inventory.schemas";

// Retención, liberación y consumo de stock (sección 14). Todas reciben una transacción en curso:
// si cualquier paso falla, el pedido entero se revierte y no queda stock asignado a medias.

type Tx = Prisma.TransactionClient;

export type StockItem = { varianteId: string; cantidad: number };

/**
 * Retiene stock para todos los ítems de un pedido, todo o nada (RN-01, RN-05, RN-P-01).
 * Cada variante se descuenta con un UPDATE condicional: si dos pedidos compiten por la última
 * unidad, PostgreSQL bloquea la fila y reevalúa la condición, así que solo uno la obtiene.
 * Los ítems se procesan ordenados por variante para que dos pedidos no se bloqueen entre sí.
 */
export async function reserveStock(tx: Tx, pedidoId: string, items: StockItem[]): Promise<RetencionStock[]> {
  const requested = new Map<string, number>();
  for (const { varianteId, cantidad } of stockItemsSchema.parse(items)) {
    requested.set(varianteId, (requested.get(varianteId) ?? 0) + cantidad);
  }

  const retentions: RetencionStock[] = [];
  for (const [varianteId, cantidad] of [...requested].sort(([a], [b]) => a.localeCompare(b))) {
    const updated = await tx.$queryRaw<{ id: string }[]>`
      UPDATE variante v SET stock_reservado = v.stock_reservado + ${cantidad}
      FROM producto p
      WHERE v.id = ${varianteId}::uuid AND p.id = v.producto_id AND v.activa AND p.activo
        AND v.stock_fisico - v.stock_reservado >= ${cantidad}
      RETURNING v.id`;
    if (updated.length === 0) {
      throw new AppError("STOCK_INSUFICIENTE", "Uno de los productos ya no tiene stock suficiente.", 409, { varianteId });
    }

    const retention = await tx.retencionStock.create({ data: { pedidoId, varianteId, cantidad } });
    await tx.movimientoStock.create({
      data: { tipo: "RETENCION", varianteId, deltaFisico: 0, deltaReservado: cantidad, retencionId: retention.id },
    });
    retentions.push(retention);
  }
  return retentions;
}

/**
 * Libera una retención activa (cancelación o vencimiento). Idempotente: si ya fue liberada
 * o consumida, no hace nada y devuelve `false` (RN-06).
 */
export async function releaseRetention(tx: Tx, retencionId: string, motivo: MotivoLiberacion): Promise<boolean> {
  const [closed] = await tx.$queryRaw<{ variante_id: string; cantidad: number }[]>`
    UPDATE retencion_stock
    SET estado = 'LIBERADA', motivo_liberacion = ${motivo}::"MotivoLiberacion", cerrada_en = now()
    WHERE id = ${retencionId}::uuid AND estado = 'ACTIVA'
    RETURNING variante_id, cantidad`;
  if (!closed) return false;

  await tx.$executeRaw`
    UPDATE variante SET stock_reservado = stock_reservado - ${closed.cantidad} WHERE id = ${closed.variante_id}::uuid`;
  await tx.movimientoStock.create({
    data: { tipo: "LIBERACION", varianteId: closed.variante_id, deltaFisico: 0, deltaReservado: -closed.cantidad, retencionId },
  });
  return true;
}

/** Consume una retención activa al despachar o entregar: las unidades salen del stock físico (14.6). */
export async function consumeRetention(tx: Tx, retencionId: string): Promise<boolean> {
  const [closed] = await tx.$queryRaw<{ variante_id: string; cantidad: number }[]>`
    UPDATE retencion_stock SET estado = 'CONSUMIDA', cerrada_en = now()
    WHERE id = ${retencionId}::uuid AND estado = 'ACTIVA'
    RETURNING variante_id, cantidad`;
  if (!closed) return false;

  await tx.$executeRaw`
    UPDATE variante
    SET stock_fisico = stock_fisico - ${closed.cantidad}, stock_reservado = stock_reservado - ${closed.cantidad}
    WHERE id = ${closed.variante_id}::uuid`;
  await tx.movimientoStock.create({
    data: {
      tipo: "CONSUMO",
      varianteId: closed.variante_id,
      deltaFisico: -closed.cantidad,
      deltaReservado: -closed.cantidad,
      retencionId,
    },
  });
  return true;
}

/** Libera todas las retenciones activas de un pedido, en orden de variante. Devuelve cuántas liberó. */
export async function releaseOrderRetentions(tx: Tx, pedidoId: string, motivo: MotivoLiberacion): Promise<number> {
  const active = await tx.retencionStock.findMany({
    where: { pedidoId, estado: "ACTIVA" },
    orderBy: { varianteId: "asc" },
    select: { id: true },
  });
  let released = 0;
  for (const { id } of active) {
    if (await releaseRetention(tx, id, motivo)) released++;
  }
  return released;
}
