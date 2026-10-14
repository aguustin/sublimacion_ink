import { z } from "zod";

const MAX_UNITS = 1_000_000;

export const stockItemsSchema = z
  .array(z.object({ varianteId: z.uuid(), cantidad: z.number().int().min(1).max(MAX_UNITS) }))
  .min(1);

/** Movimiento manual (RF-08): un ingreso suma unidades; un ajuste corrige el stock físico y exige motivo. */
export const stockMovementSchema = z.discriminatedUnion("tipo", [
  z.strictObject({
    tipo: z.literal("INGRESO"),
    cantidad: z.number().int("Ingresá unidades enteras.").min(1, "El ingreso debe ser de al menos 1 unidad.").max(MAX_UNITS),
    motivo: z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().max(500).optional()),
  }),
  z.strictObject({
    tipo: z.literal("AJUSTE"),
    /** Diferencia con signo sobre el stock físico. */
    cantidad: z
      .number()
      .int("Ingresá unidades enteras.")
      .min(-MAX_UNITS)
      .max(MAX_UNITS)
      .refine((value) => value !== 0, "El ajuste no puede ser cero."),
    motivo: z.string().trim().min(3, "Indicá el motivo del ajuste.").max(500),
  }),
]);

const threshold = z.number().int().min(0).max(MAX_UNITS).nullable().optional();

export const createMaterialSchema = z.strictObject({
  nombre: z.string().trim().min(1, "Ingresá un nombre.").max(120),
  unidad: z.string().trim().min(1, "Indicá la unidad (por ejemplo: unidad, cm², ml).").max(20),
  umbralStockBajo: threshold,
});

export const updateMaterialSchema = z.strictObject({
  nombre: z.string().trim().min(1).max(120).optional(),
  unidad: z.string().trim().min(1).max(20).optional(),
  umbralStockBajo: threshold,
  activo: z.boolean().optional(),
});

export const movementsQuerySchema = z.union([
  z.object({ varianteId: z.uuid() }),
  z.object({ materialId: z.uuid() }),
]);
