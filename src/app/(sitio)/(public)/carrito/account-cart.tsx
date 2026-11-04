"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson, sendJson, type ApiResult } from "@/lib/api";
import { notifyCartChanged } from "@/lib/guest-cart";
import type { CartView } from "@/server/modules/cart/cart.service";
import { CartTable } from "./cart-table";

/** Carrito de un cliente con sesión: cada cambio se guarda en el servidor, que vuelve a validar el stock. */
export function AccountCart({ initialCart }: { initialCart: CartView }) {
  const [cart, setCart] = useState(initialCart);
  const [error, setError] = useState<string | null>(null);

  async function apply(request: Promise<ApiResult<CartView>>) {
    const result = await request;
    if (result.ok) {
      setCart(result.data);
      setError(null);
      notifyCartChanged();
    } else {
      setError(result.error.mensaje);
    }
  }

  const priceChanged = cart.items.some((item) => item.advertencias.includes("PRECIO_CAMBIO"));
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {priceChanged && (
        <p>
          Algunos precios cambiaron. Se cobra el precio vigente al confirmar la compra.{" "}
          <button type="button" onClick={() => apply(postJson<CartView>("/api/cart/prices/accept"))}>
            Entendido
          </button>
        </p>
      )}
      <CartTable
        // Al recibir el carrito actualizado se vuelven a montar los campos con las cantidades vigentes.
        key={JSON.stringify(cart.items.map((item) => [item.id, item.cantidad]))}
        cart={cart}
        onQuantityChange={(item, cantidad) => apply(sendJson<CartView>("PATCH", `/api/cart/items/${item.id}`, { cantidad }))}
        onRemove={(item) => apply(sendJson<CartView>("DELETE", `/api/cart/items/${item.id}`))}
        actions={
          <Link href="/checkout" className="ink-btn ink-btn-primary">
            Continuar compra
          </Link>
        }
      />
    </>
  );
}
