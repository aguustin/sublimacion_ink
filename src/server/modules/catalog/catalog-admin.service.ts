import { randomBytes } from "node:crypto";
import { Prisma, type TipoProducto } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import {
  adminListSchema,
  createCategorySchema,
  createProductSchema,
  createVariantSchema,
  updateCategorySchema,
  updateProductSchema,
  updateVariantSchema,
} from "./catalog.schemas";
import { slugify, uniqueSlug } from "./slug";

const ADMIN_PAGE_SIZE = 50;

// ---------- Categorías

export function listCategories(db: Db = getDb()) {
  return db.categoria.findMany({
    orderBy: { nombre: "asc" },
    include: { _count: { select: { productos: true } } },
  });
}

export async function createCategory(actor: Actor, input: unknown, db: Db = getDb()) {
  const data = createCategorySchema.parse(input);
  return db.$transaction(async (tx) => {
    const slug = await uniqueSlug(data.nombre, async (candidate) => (await tx.categoria.count({ where: { slug: candidate } })) > 0);
    const category = await tx.categoria.create({ data: { nombre: data.nombre, slug } });
    await audit(tx, actor, "CATEGORIA_CREADA", "categoria", category.id, { nombre: category.nombre });
    return category;
  });
}

export async function updateCategory(actor: Actor, id: string, input: unknown, db: Db = getDb()) {
  const data = updateCategorySchema.parse(input);
  return db.$transaction(async (tx) => {
    await findOrThrow(() => tx.categoria.findUnique({ where: { id } }), id, "CATEGORIA_NO_ENCONTRADA", "No existe esa categoría.");
    const category = await tx.categoria.update({ where: { id }, data });
    await audit(tx, actor, "CATEGORIA_ACTUALIZADA", "categoria", id, data);
    return category;
  });
}

// ---------- Productos

export async function listAdminProducts(input: unknown, db: Db = getDb()) {
  const { q, pagina } = adminListSchema.parse(input);
  const where: Prisma.ProductoWhereInput = q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { slug: { contains: slugify(q) } }] } : {};
  const [productos, total] = await Promise.all([
    db.producto.findMany({
      where,
      orderBy: { nombre: "asc" },
      skip: (pagina - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: { categoria: { select: { nombre: true } }, _count: { select: { variantes: true } } },
    }),
    db.producto.count({ where }),
  ]);
  return { productos, total, pagina };
}

export async function getAdminProduct(id: string, db: Db = getDb()) {
  return findOrThrow(
    () =>
      db.producto.findUnique({
        where: { id },
        include: {
          categoria: true,
          variantes: { orderBy: { creadoEn: "asc" } },
          imagenes: {
            where: { archivo: { estado: "ACTIVO" } },
            orderBy: { orden: "asc" },
            include: { archivo: { select: { nombreOriginal: true } } },
          },
        },
      }),
    id,
    "PRODUCTO_NO_ENCONTRADO",
    "No existe ese producto.",
  );
}

export async function createProduct(actor: Actor, input: unknown, db: Db = getDb()) {
  const data = createProductSchema.parse(input);
  return db.$transaction(async (tx) => {
    await assertCategoryExists(tx, data.categoriaId);
    const slug = await uniqueSlug(data.nombre, async (candidate) => (await tx.producto.count({ where: { slug: candidate } })) > 0);
    const product = await tx.producto.create({ data: { ...data, slug } });
    await audit(tx, actor, "PRODUCTO_CREADO", "producto", product.id, { nombre: product.nombre, tipo: product.tipo });
    return product;
  });
}

export async function updateProduct(actor: Actor, id: string, input: unknown, db: Db = getDb()) {
  const data = updateProductSchema.parse(input);
  return db.$transaction(async (tx) => {
    await findOrThrow(() => tx.producto.findUnique({ where: { id } }), id, "PRODUCTO_NO_ENCONTRADO", "No existe ese producto.");
    if (data.categoriaId) await assertCategoryExists(tx, data.categoriaId);
    const product = await tx.producto.update({ where: { id }, data });
    await audit(tx, actor, "PRODUCTO_ACTUALIZADO", "producto", id, data);
    return product;
  });
}

// ---------- Variantes

export async function createVariant(actor: Actor, productId: string, input: unknown, db: Db = getDb()) {
  const { sku, ...data } = createVariantSchema.parse(input);
  return withUniqueSku(() =>
    db.$transaction(async (tx) => {
      const product = await findOrThrow(
        () => tx.producto.findUnique({ where: { id: productId } }),
        productId,
        "PRODUCTO_NO_ENCONTRADO",
        "No existe ese producto.",
      );
      assertPriceMatchesType(product.tipo, data.precioCentavos ?? null);
      const variant = await tx.variante.create({
        data: { ...data, productoId: productId, sku: sku ?? generateSku(product.slug) },
      });
      await audit(tx, actor, "VARIANTE_CREADA", "variante", variant.id, {
        productoId: productId,
        sku: variant.sku,
        precioCentavos: variant.precioCentavos,
      });
      return variant;
    }),
  );
}

export async function updateVariant(actor: Actor, id: string, input: unknown, db: Db = getDb()) {
  const data = updateVariantSchema.parse(input);
  return withUniqueSku(() =>
    db.$transaction(async (tx) => {
      const current = await findOrThrow(
        () => tx.variante.findUnique({ where: { id }, include: { producto: true } }),
        id,
        "VARIANTE_NO_ENCONTRADA",
        "No existe esa variante.",
      );
      if (data.precioCentavos !== undefined) assertPriceMatchesType(current.producto.tipo, data.precioCentavos);

      const variant = await tx.variante.update({ where: { id }, data });
      await audit(tx, actor, "VARIANTE_ACTUALIZADA", "variante", id, data);
      if (data.precioCentavos !== undefined && data.precioCentavos !== current.precioCentavos) {
        await audit(tx, actor, "PRECIO_MODIFICADO", "variante", id, {
          antesCentavos: current.precioCentavos,
          despuesCentavos: data.precioCentavos,
        });
      }
      return variant;
    }),
  );
}

/**
 * Estándar: precio obligatorio (RN-26). Personalizable: sin precio, porque el catálogo
 * muestra «Consultá el precio» hasta definir D-10.
 */
function assertPriceMatchesType(type: TipoProducto, priceCents: number | null): void {
  if (type === "ESTANDAR" && priceCents === null) {
    throw new AppError("PRECIO_REQUERIDO", "Los productos estándar necesitan un precio.", 422);
  }
  if (type === "PERSONALIZABLE" && priceCents !== null) {
    throw new AppError("PRECIO_NO_PERMITIDO", "Los productos personalizables todavía no llevan precio en el catálogo.", 422);
  }
}

function generateSku(productSlug: string): string {
  return `${productSlug.slice(0, 40)}-${randomBytes(3).toString("hex")}`.toUpperCase();
}

async function withUniqueSku<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("SKU_EN_USO", "Ya existe una variante con ese SKU.", 409);
    }
    throw error;
  }
}

async function assertCategoryExists(db: DbClient, categoryId: string): Promise<void> {
  if ((await db.categoria.count({ where: { id: categoryId } })) === 0) {
    throw new AppError("CATEGORIA_NO_ENCONTRADA", "No existe esa categoría.", 422);
  }
}

/** Un id que no es UUID se trata igual que uno inexistente: 404. */
async function findOrThrow<T>(find: () => Promise<T | null>, id: string, code: string, message: string): Promise<T> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const record = isUuid ? await find() : null;
  if (!record) throw new AppError(code, message, 404);
  return record;
}

function audit(db: DbClient, actor: Actor, accion: string, entidad: string, entidadId: string, datos: Prisma.InputJsonValue): Promise<void> {
  return recordAudit(db, { actorId: actor.id, accion, entidad, entidadId, datos, ip: actor.ip });
}
