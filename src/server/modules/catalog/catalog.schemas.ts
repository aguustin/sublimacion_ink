import { z } from "zod";

/** Los formularios GET envían campos vacíos como "": se tratan como ausentes. */
const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

// Filtros del catálogo público: un valor inválido se ignora en lugar de romper la página.
const lenient = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional()).catch(undefined);

const pesos = lenient(z.coerce.number().nonnegative().max(100_000_000));

export const PAGE_SIZE = 24;

export const catalogFiltersSchema = z
  .object({
    q: lenient(z.string().trim().max(100)),
    categoria: lenient(z.string().trim().max(100)),
    tipo: lenient(z.enum(["ESTANDAR", "PERSONALIZABLE"])),
    material: lenient(z.string().trim().max(100)),
    medida: lenient(z.string().trim().max(100)),
    /** En pesos; se convierten a centavos para comparar. */
    precioMin: pesos,
    precioMax: pesos,
    pagina: z.coerce.number().int().min(1).max(1000).catch(1),
  })
  .transform(({ precioMin, precioMax, ...filters }) => ({
    ...filters,
    precioMinCentavos: precioMin === undefined ? undefined : Math.round(precioMin * 100),
    precioMaxCentavos: precioMax === undefined ? undefined : Math.round(precioMax * 100),
  }));

export type CatalogFilters = z.output<typeof catalogFiltersSchema>;

// ---------- Administración

const name = z.string().trim().min(1, "Ingresá un nombre.").max(120);
const attribute = z.preprocess(emptyToUndefined, z.string().trim().max(60).nullable().optional());
const priceCents = z.number().int("El precio debe estar en centavos.").positive("El precio debe ser mayor a cero.").max(10_000_000_000);

export const createCategorySchema = z.strictObject({ nombre: name });

export const updateCategorySchema = z.strictObject({ nombre: name.optional(), activa: z.boolean().optional() });

export const createProductSchema = z.strictObject({
  nombre: name,
  descripcion: z.string().trim().max(5000).default(""),
  categoriaId: z.uuid("Elegí una categoría."),
  tipo: z.enum(["ESTANDAR", "PERSONALIZABLE"], "Elegí el tipo de producto."),
});

/** El tipo no se puede cambiar: define si las variantes llevan precio. */
export const updateProductSchema = z.strictObject({
  nombre: name.optional(),
  descripcion: z.string().trim().max(5000).optional(),
  categoriaId: z.uuid("Elegí una categoría.").optional(),
  activo: z.boolean().optional(),
});

const variantFields = {
  material: attribute,
  medida: attribute,
  color: attribute,
  talle: attribute,
  precioCentavos: priceCents.nullable().optional(),
};

export const createVariantSchema = z.strictObject({
  sku: z.preprocess(emptyToUndefined, z.string().trim().max(60).optional()),
  ...variantFields,
});

export const updateVariantSchema = z.strictObject({
  sku: z.string().trim().min(1).max(60).optional(),
  ...variantFields,
  activa: z.boolean().optional(),
  /** Alerta de stock bajo (RF-11). El stock se modifica solo con movimientos (inventario). */
  umbralStockBajo: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

export const adminListSchema = z.object({
  q: optionalText(100),
  pagina: z.coerce.number().int().min(1).default(1),
});
