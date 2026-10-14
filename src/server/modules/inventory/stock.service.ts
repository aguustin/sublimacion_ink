import { Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { logger } from "@/server/shared/logger";
import { createMaterialSchema, movementsQuerySchema, stockMovementSchema, updateMaterialSchema } from "./inventory.schemas";

type StockTable = "variante" | "material";

/** Disponible = físico − reservado (sección 14.1). */
export const available = (stock: { stockFisico: number; stockReservado: number }) => stock.stockFisico - stock.stockReservado;

const isLow = (stock: { stockFisico: number; stockReservado: number; umbralStockBajo: number | null }) =>
  stock.umbralStockBajo !== null && available(stock) <= stock.umbralStockBajo;

/**
 * Ingreso o ajuste manual del stock físico (RF-08). El UPDATE es condicional: el físico nunca
 * queda por debajo de lo reservado (y por lo tanto nunca negativo), ni siquiera con dos ajustes simultáneos.
 */
async function registerMovement(table: StockTable, actor: Actor, id: string, input: unknown, db: Db) {
  const movement = stockMovementSchema.parse(input);
  const target = Prisma.raw(table === "variante" ? "variante" : "material");

  return db.$transaction(async (tx) => {
    const [updated] = await tx.$queryRaw<{ stock_fisico: number; stock_reservado: number }[]>`
      UPDATE ${target} SET stock_fisico = stock_fisico + ${movement.cantidad}, actualizado_en = now()
      WHERE id = ${id}::uuid AND stock_fisico + ${movement.cantidad} >= stock_reservado
      RETURNING stock_fisico, stock_reservado`;

    if (!updated) {
      const [current] = await tx.$queryRaw<{ stock_reservado: number }[]>`
        SELECT stock_reservado FROM ${target} WHERE id = ${id}::uuid`;
      if (!current) throw notFound(table);
      throw new AppError(
        "AJUSTE_INVALIDO",
        `El stock físico no puede quedar por debajo de las unidades reservadas (${current.stock_reservado}).`,
        409,
        { reservado: current.stock_reservado },
      );
    }

    await tx.movimientoStock.create({
      data: {
        tipo: movement.tipo,
        ...(table === "variante" ? { varianteId: id } : { materialId: id }),
        deltaFisico: movement.cantidad,
        deltaReservado: 0,
        motivo: movement.motivo,
        autorId: actor.id,
      },
    });
    return { stockFisico: updated.stock_fisico, stockReservado: updated.stock_reservado };
  });
}

function notFound(table: StockTable): AppError {
  return table === "variante"
    ? new AppError("VARIANTE_NO_ENCONTRADA", "No existe esa variante.", 404)
    : new AppError("MATERIAL_NO_ENCONTRADO", "No existe ese material.", 404);
}

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export function registerVariantMovement(actor: Actor, varianteId: string, input: unknown, db: Db = getDb()) {
  if (!isUuid(varianteId)) throw notFound("variante");
  return registerMovement("variante", actor, varianteId, input, db);
}

export function registerMaterialMovement(actor: Actor, materialId: string, input: unknown, db: Db = getDb()) {
  if (!isUuid(materialId)) throw notFound("material");
  return registerMovement("material", actor, materialId, input, db);
}

/** Historial de una variante o un material, del más reciente al más antiguo (RF-10). */
export function listMovements(input: unknown, db: Db = getDb()) {
  const query = movementsQuerySchema.parse(input);
  return db.movimientoStock.findMany({ where: query, orderBy: { creadoEn: "desc" }, take: 200 });
}

// ---------- Materiales (RF-09)

export async function createMaterial(actor: Actor, input: unknown, db: Db = getDb()) {
  const data = createMaterialSchema.parse(input);
  return db.$transaction(async (tx) => {
    const material = await tx.material.create({ data });
    await recordAudit(tx, { actorId: actor.id, accion: "MATERIAL_CREADO", entidad: "material", entidadId: material.id, datos: data, ip: actor.ip });
    return material;
  });
}

export async function updateMaterial(actor: Actor, id: string, input: unknown, db: Db = getDb()) {
  const data = updateMaterialSchema.parse(input);
  if (!isUuid(id)) throw notFound("material");
  return db.$transaction(async (tx) => {
    if ((await tx.material.count({ where: { id } })) === 0) throw notFound("material");
    const material = await tx.material.update({ where: { id }, data });
    await recordAudit(tx, { actorId: actor.id, accion: "MATERIAL_ACTUALIZADO", entidad: "material", entidadId: id, datos: data, ip: actor.ip });
    return material;
  });
}

export async function getMaterial(id: string, db: Db = getDb()) {
  const material = isUuid(id) ? await db.material.findUnique({ where: { id } }) : null;
  if (!material) throw notFound("material");
  return material;
}

export async function getVariantStock(id: string, db: Db = getDb()) {
  const variant = isUuid(id)
    ? await db.variante.findUnique({ where: { id }, include: { producto: { select: { id: true, nombre: true, tipo: true } } } })
    : null;
  if (!variant) throw notFound("variante");
  return variant;
}

// ---------- Vista general (RF-11)

export async function getInventoryOverview({ onlyLow = false } = {}, db: Db = getDb()) {
  const [variants, materials] = await Promise.all([
    db.variante.findMany({
      include: { producto: { select: { id: true, nombre: true, tipo: true, activo: true } } },
      orderBy: [{ producto: { nombre: "asc" } }, { creadoEn: "asc" }],
    }),
    db.material.findMany({ orderBy: { nombre: "asc" } }),
  ]);
  const variantes = variants
    .map((variant) => ({ ...variant, disponible: available(variant), stockBajo: isLow(variant) }))
    .filter((variant) => !onlyLow || variant.stockBajo);
  const materiales = materials
    .map((material) => ({ ...material, disponible: available(material), stockBajo: isLow(material) }))
    .filter((material) => !onlyLow || material.stockBajo);
  return { variantes, materiales };
}

// ---------- Conciliación (sección 14.8)

export type StockDiscrepancy = {
  tipo: StockTable;
  id: string;
  stockFisico: number;
  stockReservado: number;
  fisicoSegunMovimientos: number;
  reservadoSegunMovimientos: number;
  reservadoSegunRetenciones: number;
};

/**
 * Compara el stock guardado con la suma de los movimientos y de las retenciones activas.
 * No corrige: informa y deja registro en el log para investigar.
 */
export async function reconcileStock(db: Db = getDb()): Promise<StockDiscrepancy[]> {
  const rows = await db.$queryRaw<
    { tipo: StockTable; id: string; fisico: number; reservado: number; mov_fisico: bigint; mov_reservado: bigint; retenido: bigint }[]
  >`
    SELECT 'variante' AS tipo, v.id, v.stock_fisico AS fisico, v.stock_reservado AS reservado,
           COALESCE(m.fisico, 0) AS mov_fisico, COALESCE(m.reservado, 0) AS mov_reservado, COALESCE(r.cantidad, 0) AS retenido
    FROM variante v
    LEFT JOIN (SELECT variante_id, SUM(delta_fisico) AS fisico, SUM(delta_reservado) AS reservado
               FROM movimiento_stock WHERE variante_id IS NOT NULL GROUP BY variante_id) m ON m.variante_id = v.id
    LEFT JOIN (SELECT variante_id, SUM(cantidad) AS cantidad
               FROM retencion_stock WHERE estado = 'ACTIVA' GROUP BY variante_id) r ON r.variante_id = v.id
    UNION ALL
    SELECT 'material', ma.id, ma.stock_fisico, ma.stock_reservado,
           COALESCE(m.fisico, 0), COALESCE(m.reservado, 0), COALESCE(m.reservado, 0)
    FROM material ma
    LEFT JOIN (SELECT material_id, SUM(delta_fisico) AS fisico, SUM(delta_reservado) AS reservado
               FROM movimiento_stock WHERE material_id IS NOT NULL GROUP BY material_id) m ON m.material_id = ma.id`;

  const discrepancies = rows
    .map((row) => ({
      tipo: row.tipo,
      id: row.id,
      stockFisico: row.fisico,
      stockReservado: row.reservado,
      fisicoSegunMovimientos: Number(row.mov_fisico),
      reservadoSegunMovimientos: Number(row.mov_reservado),
      reservadoSegunRetenciones: Number(row.retenido),
    }))
    .filter(
      (row) =>
        row.stockFisico !== row.fisicoSegunMovimientos ||
        row.stockReservado !== row.reservadoSegunMovimientos ||
        row.stockReservado !== row.reservadoSegunRetenciones,
    );

  if (discrepancies.length > 0) logger.warn({ diferencias: discrepancies }, "conciliación de stock con diferencias");
  return discrepancies;
}
