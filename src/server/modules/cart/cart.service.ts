import type { Prisma } from "@/generated/prisma/client";
import { available } from "@/server/modules/inventory/stock.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { addItemSchema, guestCartSchema, MAX_QUANTITY, updateItemSchema } from "./cart.schemas";

// Carrito (RF-12, RF-13, RN-01, RN-27). No retiene stock: solo avisa. La validación definitiva
// de stock y precio ocurre al confirmar la operación (INC-05.2).

const variantInclude = { producto: { select: { nombre: true, slug: true, tipo: true, activo: true } } } satisfies Prisma.VarianteInclude;
type CartVariant = Prisma.VarianteGetPayload<{ include: typeof variantInclude }>;

export type CartWarning =
  /** El producto o la variante se desactivó: no se puede comprar. */
  | "NO_DISPONIBLE"
  /** No queda ninguna unidad disponible. */
  | "SIN_STOCK"
  /** Hay menos unidades disponibles que las pedidas. */
  | "STOCK_INSUFICIENTE"
  /** El precio cambió desde que se agregó (RN-27: se cobra el vigente). */
  | "PRECIO_CAMBIO";

export type CartItemView = {
  /** `null` en el carrito de un visitante, que no está guardado en el servidor. */
  id: string | null;
  varianteId: string;
  producto: { nombre: string; slug: string };
  variante: string;
  cantidad: number;
  precioUnitarioCentavos: number | null;
  precioAlAgregarCentavos: number | null;
  disponible: number;
  advertencias: CartWarning[];
};

export type CartView = {
  items: CartItemView[];
  /** Subtotal a precios vigentes de los ítems que se pueden comprar. No incluye envío. */
  subtotalCentavos: number;
  hayAdvertencias: boolean;
};

const describeVariant = (variant: CartVariant) =>
  [variant.material, variant.medida, variant.color, variant.talle].filter(Boolean).join(" · ") || "Única";

/** Una variante se puede agregar si está activa, su producto también y es un producto estándar con precio. */
function isPurchasable(variant: CartVariant): boolean {
  return variant.activa && variant.producto.activo && variant.producto.tipo === "ESTANDAR" && variant.precioCentavos !== null;
}

function toItemView(variant: CartVariant, cantidad: number, id: string | null, priceWhenAdded: number | null): CartItemView {
  const disponible = Math.max(0, available(variant));
  const advertencias: CartWarning[] = [];
  if (!isPurchasable(variant)) advertencias.push("NO_DISPONIBLE");
  else if (disponible === 0) advertencias.push("SIN_STOCK");
  else if (disponible < cantidad) advertencias.push("STOCK_INSUFICIENTE");
  if (priceWhenAdded !== null && variant.precioCentavos !== null && priceWhenAdded !== variant.precioCentavos) {
    advertencias.push("PRECIO_CAMBIO");
  }
  return {
    id,
    varianteId: variant.id,
    producto: { nombre: variant.producto.nombre, slug: variant.producto.slug },
    variante: describeVariant(variant),
    cantidad,
    precioUnitarioCentavos: variant.precioCentavos,
    precioAlAgregarCentavos: priceWhenAdded,
    disponible,
    advertencias,
  };
}

function toCartView(items: CartItemView[]): CartView {
  const subtotalCentavos = items
    .filter((item) => !item.advertencias.includes("NO_DISPONIBLE"))
    .reduce((sum, item) => sum + (item.precioUnitarioCentavos ?? 0) * item.cantidad, 0);
  return { items, subtotalCentavos, hayAdvertencias: items.some((item) => item.advertencias.length > 0) };
}

async function findVariant(db: DbClient, varianteId: string): Promise<CartVariant> {
  const variant = await db.variante.findUnique({ where: { id: varianteId }, include: variantInclude });
  if (!variant) throw new AppError("VARIANTE_NO_ENCONTRADA", "No existe ese producto.", 404);
  if (variant.producto.tipo === "PERSONALIZABLE") {
    throw new AppError("PRODUCTO_PERSONALIZABLE", "Los productos personalizables se piden con una solicitud de personalización.", 422);
  }
  if (!isPurchasable(variant)) throw new AppError("PRODUCTO_NO_DISPONIBLE", "Ese producto ya no está a la venta.", 409);
  return variant;
}

/** RN-01: no se agrega más de lo disponible. */
function assertAvailable(variant: CartVariant, cantidad: number): void {
  const disponible = Math.max(0, available(variant));
  if (cantidad > disponible) {
    throw new AppError(
      "STOCK_INSUFICIENTE",
      disponible === 0 ? "Ese producto no tiene stock." : `Solo quedan ${disponible} unidades disponibles.`,
      409,
      { disponible },
    );
  }
}

async function cartIdOf(db: DbClient, userId: string): Promise<string> {
  const cart = await db.carrito.upsert({ where: { usuarioId: userId }, create: { usuarioId: userId }, update: {} });
  return cart.id;
}

export async function getCart(userId: string, db: Db = getDb()): Promise<CartView> {
  const cart = await db.carrito.findUnique({
    where: { usuarioId: userId },
    include: { items: { include: { variante: { include: variantInclude } }, orderBy: { creadoEn: "asc" } } },
  });
  return toCartView(
    (cart?.items ?? []).map((item) => toItemView(item.variante, item.cantidad, item.id, item.precioAlAgregarCentavos)),
  );
}

/** Agrega unidades; si la variante ya está en el carrito, se suman. */
export async function addItem(userId: string, input: unknown, db: Db = getDb()): Promise<CartView> {
  const { varianteId, cantidad } = addItemSchema.parse(input);
  await db.$transaction(async (tx) => {
    const variant = await findVariant(tx, varianteId);
    const carritoId = await cartIdOf(tx, userId);
    const existing = await tx.itemCarrito.findUnique({ where: { carritoId_varianteId: { carritoId, varianteId } } });
    const total = (existing?.cantidad ?? 0) + cantidad;
    assertAvailable(variant, total);
    await tx.itemCarrito.upsert({
      where: { carritoId_varianteId: { carritoId, varianteId } },
      create: { carritoId, varianteId, cantidad, precioAlAgregarCentavos: variant.precioCentavos! },
      update: { cantidad: total },
    });
  });
  return getCart(userId, db);
}

/** Cambia la cantidad. Reducirla siempre se permite; aumentarla exige stock. */
export async function updateItem(userId: string, itemId: string, input: unknown, db: Db = getDb()): Promise<CartView> {
  const { cantidad } = updateItemSchema.parse(input);
  await db.$transaction(async (tx) => {
    const item = await findOwnItem(tx, userId, itemId);
    if (cantidad > item.cantidad) {
      const variant = await findVariant(tx, item.varianteId);
      assertAvailable(variant, cantidad);
    }
    await tx.itemCarrito.update({ where: { id: item.id }, data: { cantidad } });
  });
  return getCart(userId, db);
}

export async function removeItem(userId: string, itemId: string, db: Db = getDb()): Promise<CartView> {
  const item = await findOwnItem(db, userId, itemId);
  await db.itemCarrito.delete({ where: { id: item.id } });
  return getCart(userId, db);
}

/** El cliente vio los precios nuevos: deja de avisar el cambio (RF-13). Se cobra igual el vigente al confirmar (RN-27). */
export async function acceptCurrentPrices(userId: string, db: Db = getDb()): Promise<CartView> {
  await db.$executeRaw`
    UPDATE item_carrito i SET precio_al_agregar_centavos = v.precio_centavos, actualizado_en = now()
    FROM carrito c, variante v
    WHERE i.carrito_id = c.id AND c.usuario_id = ${userId}::uuid AND v.id = i.variante_id
      AND v.precio_centavos IS NOT NULL AND v.precio_centavos <> i.precio_al_agregar_centavos`;
  return getCart(userId, db);
}

/** Vista de un carrito de visitante, con las mismas advertencias que uno guardado. No guarda nada. */
export async function previewGuestCart(input: unknown, db: Db = getDb()): Promise<CartView> {
  const { items } = guestCartSchema.parse(input);
  const variants = await db.variante.findMany({
    where: { id: { in: items.map((item) => item.varianteId) } },
    include: variantInclude,
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  return toCartView(
    mergeQuantities(items).flatMap(([varianteId, cantidad]) => {
      const variant = byId.get(varianteId);
      return variant ? [toItemView(variant, cantidad, null, null)] : [];
    }),
  );
}

export type MergeResult = {
  carrito: CartView;
  /** Ítems que no se pudieron agregar (sin stock, inactivos, personalizables o inexistentes). */
  descartados: string[];
  /** Ítems cuya cantidad se redujo a lo disponible. */
  ajustados: string[];
};

/**
 * Integra el carrito del visitante al iniciar sesión o registrarse (RN-25): suma cantidades,
 * recorta a lo disponible e informa lo que no se pudo agregar, sin interrumpir la compra.
 */
export async function mergeGuestCart(userId: string, input: unknown, db: Db = getDb()): Promise<MergeResult> {
  const { items } = guestCartSchema.parse(input);
  const descartados: string[] = [];
  const ajustados: string[] = [];

  await db.$transaction(async (tx) => {
    const carritoId = await cartIdOf(tx, userId);
    for (const [varianteId, cantidad] of mergeQuantities(items)) {
      const variant = await tx.variante.findUnique({ where: { id: varianteId }, include: variantInclude });
      const disponible = variant ? Math.max(0, available(variant)) : 0;
      if (!variant || !isPurchasable(variant) || disponible === 0) {
        descartados.push(varianteId);
        continue;
      }
      const existing = await tx.itemCarrito.findUnique({ where: { carritoId_varianteId: { carritoId, varianteId } } });
      const wanted = Math.min((existing?.cantidad ?? 0) + cantidad, MAX_QUANTITY);
      const total = Math.min(wanted, Math.max(disponible, existing?.cantidad ?? 0));
      if (total < wanted) ajustados.push(varianteId);
      await tx.itemCarrito.upsert({
        where: { carritoId_varianteId: { carritoId, varianteId } },
        create: { carritoId, varianteId, cantidad: total, precioAlAgregarCentavos: variant.precioCentavos! },
        update: { cantidad: total },
      });
    }
  });

  return { carrito: await getCart(userId, db), descartados, ajustados };
}

function mergeQuantities(items: { varianteId: string; cantidad: number }[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const { varianteId, cantidad } of items) {
    totals.set(varianteId, Math.min((totals.get(varianteId) ?? 0) + cantidad, MAX_QUANTITY));
  }
  return [...totals];
}

/** Un ítem de otro carrito se trata como inexistente: 404, sin revelar que existe. */
async function findOwnItem(db: DbClient, userId: string, itemId: string) {
  const item = /^[0-9a-f-]{36}$/i.test(itemId)
    ? await db.itemCarrito.findFirst({ where: { id: itemId, carrito: { usuarioId: userId } } })
    : null;
  if (!item) throw new AppError("ITEM_NO_ENCONTRADO", "Ese producto no está en tu carrito.", 404);
  return item;
}
