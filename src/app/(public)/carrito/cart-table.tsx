"use client";

import Link from "next/link";
import type { CartItemView, CartView, CartWarning } from "@/server/modules/cart/cart.service";
import { formatPesos } from "@/lib/money";

const WARNING_TEXT: Record<CartWarning, (item: CartItemView) => string> = {
  NO_DISPONIBLE: () => "Ya no está a la venta. Quitalo para continuar.",
  SIN_STOCK: () => "Se quedó sin stock.",
  STOCK_INSUFICIENTE: (item) => `Solo quedan ${item.disponible} unidades.`,
  PRECIO_CAMBIO: (item) =>
    `El precio cambió${item.precioAlAgregarCentavos !== null ? ` (antes ${formatPesos(item.precioAlAgregarCentavos)})` : ""}.`,
};

/** Tabla del carrito, igual para un cliente y para un visitante. */
export function CartTable({
  cart,
  onQuantityChange,
  onRemove,
}: {
  cart: CartView;
  onQuantityChange: (item: CartItemView, cantidad: number) => void;
  onRemove: (item: CartItemView) => void;
}) {
  if (cart.items.length === 0) {
    return (
      <p>
        Tu carrito está vacío. <Link href="/productos">Ver productos</Link>
      </p>
    );
  }

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Precio</th>
            <th>Cantidad</th>
            <th>Subtotal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cart.items.map((item) => (
            <tr key={item.varianteId}>
              <td>
                <Link href={`/productos/${item.producto.slug}`}>{item.producto.nombre}</Link> · {item.variante}
                {item.advertencias.map((warning) => (
                  <p key={warning} role="alert">
                    {WARNING_TEXT[warning](item)}
                  </p>
                ))}
              </td>
              <td>{item.precioUnitarioCentavos !== null ? formatPesos(item.precioUnitarioCentavos) : "—"}</td>
              <td>
                <input
                  type="number"
                  min={1}
                  defaultValue={item.cantidad}
                  aria-label={`Cantidad de ${item.producto.nombre}`}
                  onBlur={(event) => {
                    const cantidad = Number(event.target.value);
                    if (Number.isInteger(cantidad) && cantidad >= 1 && cantidad !== item.cantidad) onQuantityChange(item, cantidad);
                  }}
                />
              </td>
              <td>{item.precioUnitarioCentavos !== null ? formatPesos(item.precioUnitarioCentavos * item.cantidad) : "—"}</td>
              <td>
                <button type="button" onClick={() => onRemove(item)}>
                  Quitar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Subtotal: <strong>{formatPesos(cart.subtotalCentavos)}</strong> (precios finales con impuestos incluidos; no incluye
        envío). El stock y el precio se confirman al finalizar la compra.
      </p>
    </>
  );
}
