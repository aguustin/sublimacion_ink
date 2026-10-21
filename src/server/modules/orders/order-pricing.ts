import type { Prisma } from "@/generated/prisma/client";
import { couponDiscount } from "@/server/modules/coupons/coupon.policy";
import { available } from "@/server/modules/inventory/stock.service";
import type { DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

// Precios vigentes de un pedido que todavía no retiene stock (reactivación, RN-28; envío, F-10).

export const withItems = { items: { include: { variante: { include: { producto: true } } }, orderBy: { id: "asc" } } } as const;

export type OrderWithItems = Prisma.PedidoGetPayload<{ include: typeof withItems }>;

export async function findOrderWithItems(db: DbClient, pedidoId: string, where: Prisma.PedidoWhereInput = {}): Promise<OrderWithItems> {
  const order = /^[0-9a-f-]{36}$/i.test(pedidoId) ? await db.pedido.findFirst({ where: { id: pedidoId, ...where }, include: withItems }) : null;
  if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  return order;
}

/** Ítems a precios vigentes (RN-27) y su disponibilidad actual. */
export function priceAtCurrentRates(order: OrderWithItems) {
  const items = order.items.map((item) => {
    const { variante } = item;
    const purchasable = variante.activa && variante.producto.activo && variante.precioCentavos !== null;
    return {
      itemId: item.id,
      varianteId: item.varianteId,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioAnteriorCentavos: item.precioUnitarioCentavos,
      precioVigenteCentavos: variante.precioCentavos,
      disponible: Math.max(0, available(variante)),
      aLaVenta: purchasable,
    };
  });
  const totalCentavos = items.reduce((sum, item) => sum + (item.precioVigenteCentavos ?? 0) * item.cantidad, 0);
  const puedeReactivarse = items.every((item) => item.aLaVenta && item.disponible >= item.cantidad);
  return { items, totalCentavos, puedeReactivarse };
}

export type CurrentPricing = ReturnType<typeof priceAtCurrentRates>;

/** RN-27: no se vuelve a vender un producto que ya no está a la venta. */
export function assertPurchasable(pricing: CurrentPricing): void {
  const unavailable = pricing.items.find((item) => !item.aLaVenta);
  if (unavailable) {
    throw new AppError("PRODUCTO_NO_DISPONIBLE", `«${unavailable.descripcion}» ya no está a la venta.`, 409, { varianteId: unavailable.varianteId });
  }
}

/** Guarda en el pedido los precios vigentes con los que se va a cobrar. */
export async function applyCurrentPrices(tx: Prisma.TransactionClient, pricing: CurrentPricing): Promise<void> {
  for (const item of pricing.items) {
    await tx.itemPedido.update({ where: { id: item.itemId }, data: { precioUnitarioCentavos: item.precioVigenteCentavos! } });
  }
}

/** Descuento del cupón del pedido sobre los productos a precio vigente (RN-20: sin vuelto ni saldo). */
export async function currentCouponDiscount(db: DbClient, order: { cuponId: string | null }, productosCentavos: number): Promise<number> {
  if (!order.cuponId) return 0;
  const coupon = await db.cupon.findUniqueOrThrow({ where: { id: order.cuponId }, select: { montoCentavos: true } });
  return couponDiscount(coupon.montoCentavos, productosCentavos);
}
