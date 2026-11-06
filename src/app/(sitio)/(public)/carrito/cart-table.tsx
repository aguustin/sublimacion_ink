"use client";

import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { InkLogo } from "@/app/ui/ink-logo";
import type { CartItemView, CartView, CartWarning } from "@/server/modules/cart/cart.service";
import { formatPesos } from "@/lib/money";
import styles from "./cart.module.css";

const WARNING_TEXT: Record<CartWarning, (item: CartItemView) => string> = {
  NO_DISPONIBLE: () => "Ya no está a la venta. Quitalo para continuar.",
  SIN_STOCK: () => "Se quedó sin stock.",
  STOCK_INSUFICIENTE: (item) => `Solo quedan ${item.disponible} unidades.`,
  PRECIO_CAMBIO: (item) => `El precio cambió${item.precioAlAgregarCentavos !== null ? ` (antes ${formatPesos(item.precioAlAgregarCentavos)})` : ""}.`,
};

/**
 * Carrito, igual para un cliente y para un visitante (Documento Maestro 5.5, rediseño v1.38): una línea
 * por producto con cantidad − / + y quitar discreto; el resumen a la derecha en escritorio y debajo en
 * móvil. `actions` son las acciones del resumen, que dependen de si hay sesión.
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

  const count = cart.items.reduce((sum, item) => sum + item.cantidad, 0);
  return (
    <div className={styles.layout}>
      <ul className={styles.items} aria-label="Productos del carrito">
        {cart.items.map((item) => (
          <li key={item.varianteId} className={styles.item}>
            <span className={styles.thumb} aria-hidden="true">
              <InkLogo variant="principal" className={styles.thumbLogo} title="" />
            </span>
            <div className={styles.itemInfo}>
              <Link href={`/productos/${item.producto.slug}`} className={styles.itemName}>
                {item.producto.nombre}
              </Link>
              <span className={styles.itemOption}>
                {item.variante}
                {item.precioUnitarioCentavos !== null && ` · ${formatPesos(item.precioUnitarioCentavos)} c/u`}
              </span>
              {item.advertencias.map((warning) => (
                <p key={warning} role="alert" className={styles.warning}>
                  {WARNING_TEXT[warning](item)}
                </p>
              ))}
            </div>
            <div className={styles.itemControls}>
              <div className={styles.stepper} role="group" aria-label={`Cantidad de ${item.producto.nombre}`}>
                <button type="button" onClick={() => onQuantityChange(item, item.cantidad - 1)} disabled={item.cantidad <= 1} aria-label="Restar uno">
                  <Minus aria-hidden="true" size={16} />
                </button>
                <span aria-live="polite">{item.cantidad}</span>
                <button
                  type="button"
                  onClick={() => onQuantityChange(item, item.cantidad + 1)}
                  disabled={item.cantidad >= item.disponible}
                  aria-label="Sumar uno"
                >
                  <Plus aria-hidden="true" size={16} />
                </button>
              </div>
              <button type="button" className={styles.remove} onClick={() => onRemove(item)}>
                <Trash2 aria-hidden="true" size={16} />
                Quitar
              </button>
            </div>
            <strong className={styles.itemTotal}>
              {item.precioUnitarioCentavos !== null ? formatPesos(item.precioUnitarioCentavos * item.cantidad) : "—"}
            </strong>
          </li>
        ))}
      </ul>
      <aside className={styles.summary} aria-labelledby="cart-summary">
        <h2 id="cart-summary">Resumen · {count === 1 ? "1 producto" : `${count} productos`}</h2>
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
