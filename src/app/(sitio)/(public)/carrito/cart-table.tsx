"use client";

import { ShoppingCart } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { CartItemView, CartView, CartWarning } from "@/server/modules/cart/cart.service";
import { formatPesos } from "@/lib/money";
import styles from "./cart.module.css";

const WARNING_TEXT: Record<CartWarning, (item: CartItemView) => string> = {
  NO_DISPONIBLE: () => "Ya no está a la venta. Quitalo para continuar.",
  SIN_STOCK: () => "Se quedó sin stock.",
  STOCK_INSUFICIENTE: (item) => `Solo quedan ${item.disponible} unidades.`,
  PRECIO_CAMBIO: (item) =>
    `El precio cambió${item.precioAlAgregarCentavos !== null ? ` (antes ${formatPesos(item.precioAlAgregarCentavos)})` : ""}.`,
};

/**
 * Carrito, igual para un cliente y para un visitante (Documento Maestro, 5.5): productos a la izquierda
 * y resumen a la derecha en escritorio; en móvil, apilado con el resumen debajo. `actions` son las
 * acciones del resumen, que dependen de si hay sesión.
 */
export function CartTable({
  cart,
  onQuantityChange,
  onRemove,
  actions,
}: {
  cart: CartView;
  onQuantityChange: (item: CartItemView, cantidad: number) => void;
  onRemove: (item: CartItemView) => void;
  actions: ReactNode;
}) {
  if (cart.items.length === 0) {
    return (
      <div className={styles.empty}>
        <ShoppingCart aria-hidden="true" size={36} />
        <p>Tu carrito está vacío.</p>
        <Link href="/productos" className="ink-btn ink-btn-primary">
          Ver productos
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <table className={`ink-table-stack ${styles.items}`}>
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
      <aside className={styles.summary} aria-labelledby="cart-summary">
        <h2 id="cart-summary">Resumen</h2>
        <p className={styles.total}>
          <span>Subtotal</span>
          <strong>{formatPesos(cart.subtotalCentavos)}</strong>
        </p>
        <p className={styles.note}>
          Precios finales con impuestos incluidos; no incluye envío. El stock y el precio se confirman al finalizar la compra.
        </p>
        {actions}
      </aside>
    </div>
  );
}
