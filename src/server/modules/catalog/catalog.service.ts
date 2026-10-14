import { Prisma, type TipoProducto } from "@/generated/prisma/client";
import { getDb, type Db } from "@/server/shared/db";
import { available } from "@/server/modules/inventory/stock.service";
import { AppError } from "@/server/shared/errors";
import { catalogFiltersSchema, PAGE_SIZE, type CatalogFilters } from "./catalog.schemas";

// Un producto es visible si está activo, su categoría está activa y tiene al menos una variante activa.

export type PublicVariant = {
  id: string;
  sku: string;
  material: string | null;
  medida: string | null;
  color: string | null;
  talle: string | null;
  /** `null` en personalizables: se muestra «Consultá el precio» hasta definir D-10. */
  precioCentavos: number | null;
  /** Unidades disponibles (físico − reservado). `null` en personalizables: depende de D-18. */
  disponible: number | null;
};

export type PublicProductSummary = {
  id: string;
  slug: string;
  nombre: string;
  tipo: TipoProducto;
  categoria: { nombre: string; slug: string };
  /** Menor precio entre las variantes activas; `null` si no tiene precio. */
  precioDesdeCentavos: number | null;
  /** Hay variantes con precios distintos («Desde $…»). */
  variasPrecios: boolean;
  /** Alguna variante activa tiene unidades disponibles. `null` en personalizables (D-18). */
  hayStock: boolean | null;
};

export type PublicProductDetail = PublicProductSummary & {
  descripcion: string;
  actualizadoEn: Date;
  variantes: PublicVariant[];
};

const visibleProduct = { activo: true, categoria: { activa: true }, variantes: { some: { activa: true } } };

const publicInclude = {
  categoria: { select: { nombre: true, slug: true } },
  variantes: { where: { activa: true }, orderBy: { creadoEn: "asc" } },
} satisfies Prisma.ProductoInclude;

type ProductWithVariants = Prisma.ProductoGetPayload<{ include: typeof publicInclude }>;

function toPublicVariant(variant: ProductWithVariants["variantes"][number], tipo: TipoProducto): PublicVariant {
  return {
    id: variant.id,
    sku: variant.sku,
    material: variant.material,
    medida: variant.medida,
    color: variant.color,
    talle: variant.talle,
    precioCentavos: tipo === "PERSONALIZABLE" ? null : variant.precioCentavos,
    disponible: tipo === "PERSONALIZABLE" ? null : available(variant),
  };
}

function toSummary(product: ProductWithVariants): PublicProductSummary {
  const prices = product.variantes
    .map((variant) => toPublicVariant(variant, product.tipo).precioCentavos)
    .filter((price): price is number => price !== null);
  return {
    id: product.id,
    slug: product.slug,
    nombre: product.nombre,
    tipo: product.tipo,
    categoria: product.categoria,
    precioDesdeCentavos: prices.length > 0 ? Math.min(...prices) : null,
    variasPrecios: new Set(prices).size > 1,
    hayStock: product.tipo === "PERSONALIZABLE" ? null : product.variantes.some((variant) => available(variant) > 0),
  };
}

/** Escapa los comodines de LIKE para que «50%» se busque literalmente. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function whereClause(filters: CatalogFilters): Prisma.Sql {
  const conditions = [Prisma.sql`p.activo`, Prisma.sql`c.activa`];
  if (filters.q) {
    conditions.push(
      Prisma.sql`unaccent(lower(p.nombre || ' ' || p.descripcion)) LIKE '%' || unaccent(lower(${escapeLike(filters.q)})) || '%' ESCAPE '\\'`,
    );
  }
  if (filters.categoria) conditions.push(Prisma.sql`c.slug = ${filters.categoria}`);
  if (filters.tipo) conditions.push(Prisma.sql`p.tipo = ${filters.tipo}::"TipoProducto"`);

  const variantConditions = [Prisma.sql`v.producto_id = p.id`, Prisma.sql`v.activa`];
  if (filters.material) variantConditions.push(Prisma.sql`v.material = ${filters.material}`);
  if (filters.medida) variantConditions.push(Prisma.sql`v.medida = ${filters.medida}`);
  if (filters.precioMinCentavos !== undefined || filters.precioMaxCentavos !== undefined) {
    // Los personalizables no tienen precio: un filtro de precio los excluye.
    variantConditions.push(Prisma.sql`p.tipo = 'ESTANDAR' AND v.precio_centavos IS NOT NULL`);
  }
  if (filters.precioMinCentavos !== undefined) variantConditions.push(Prisma.sql`v.precio_centavos >= ${filters.precioMinCentavos}`);
  if (filters.precioMaxCentavos !== undefined) variantConditions.push(Prisma.sql`v.precio_centavos <= ${filters.precioMaxCentavos}`);
  conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM variante v WHERE ${Prisma.join(variantConditions, " AND ")})`);

  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

export async function listProducts(
  input: unknown,
  db: Db = getDb(),
): Promise<{ productos: PublicProductSummary[]; total: number; pagina: number; porPagina: number }> {
  const filters = catalogFiltersSchema.parse(input);
  const where = whereClause(filters);
  const from = Prisma.sql`FROM producto p JOIN categoria c ON c.id = p.categoria_id ${where}`;

  const [rows, [count]] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`
      SELECT p.id ${from} ORDER BY unaccent(lower(p.nombre)), p.id
      LIMIT ${PAGE_SIZE} OFFSET ${(filters.pagina - 1) * PAGE_SIZE}`,
    db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from}`,
  ]);

  const ids = rows.map((row) => row.id);
  const products = await db.producto.findMany({ where: { id: { in: ids } }, include: publicInclude });
  const byId = new Map(products.map((product) => [product.id, product]));

  return {
    productos: ids.flatMap((id) => {
      const product = byId.get(id);
      return product ? [toSummary(product)] : [];
    }),
    total: Number(count?.total ?? 0),
    pagina: filters.pagina,
    porPagina: PAGE_SIZE,
  };
}

export async function getProductBySlug(slug: string, db: Db = getDb()): Promise<PublicProductDetail> {
  const product = await db.producto.findFirst({ where: { slug, ...visibleProduct }, include: publicInclude });
  if (!product) throw new AppError("PRODUCTO_NO_ENCONTRADO", "No encontramos ese producto.", 404);
  return {
    ...toSummary(product),
    descripcion: product.descripcion,
    actualizadoEn: product.actualizadoEn,
    variantes: product.variantes.map((variant) => toPublicVariant(variant, product.tipo)),
  };
}

export type CatalogFilterOptions = {
  categorias: { nombre: string; slug: string }[];
  materiales: string[];
  medidas: string[];
};

/** Valores para los filtros, tomados solo de lo que está visible. */
export async function getFilterOptions(db: Db = getDb()): Promise<CatalogFilterOptions> {
  const [categorias, attributes] = await Promise.all([
    db.categoria.findMany({
      where: { activa: true, productos: { some: { activo: true, variantes: { some: { activa: true } } } } },
      select: { nombre: true, slug: true },
      orderBy: { nombre: "asc" },
    }),
    db.$queryRaw<{ material: string | null; medida: string | null }[]>`
      SELECT DISTINCT v.material, v.medida
      FROM variante v JOIN producto p ON p.id = v.producto_id JOIN categoria c ON c.id = p.categoria_id
      WHERE v.activa AND p.activo AND c.activa`,
  ]);
  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((value): value is string => value !== null))].sort((a, b) => a.localeCompare(b, "es"));
  return {
    categorias,
    materiales: distinct(attributes.map((row) => row.material)),
    medidas: distinct(attributes.map((row) => row.medida)),
  };
}

/** Productos visibles para el sitemap. */
export function listSitemapProducts(db: Db = getDb()): Promise<{ slug: string; actualizadoEn: Date }[]> {
  return db.producto.findMany({
    where: visibleProduct,
    select: { slug: true, actualizadoEn: true },
    orderBy: { nombre: "asc" },
  });
}
