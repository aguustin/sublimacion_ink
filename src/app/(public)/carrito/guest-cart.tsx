"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { postJson } from "@/lib/api";
import { readGuestCart, setGuestQuantity, type GuestCartItem } from "@/lib/guest-cart";
import type { CartView } from "@/server/modules/cart/cart.service";
import { CartTable } from "./cart-table";

const EMPTY_CART: CartView = { items: [], subtotalCentavos: 0, hayAdvertencias: false };

/** El servidor calcula precios, stock y advertencias del carrito guardado en el navegador. */
async function loadPreview(items: GuestCartItem[]): Promise<CartView> {
  if (items.length === 0) return EMPTY_CART;
  const result = await postJson<CartView>("/api/cart/preview", { items });
  return result.ok ? result.data : EMPTY_CART;
}

/** Carrito de un visitante: vive en su navegador hasta que inicia sesión o se registra. */
export function GuestCart() {
  const [cart, setCart] = useState<CartView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPreview(readGuestCart()).then((view) => {
      if (!cancelled) setCart(view);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = async (items: GuestCartItem[]) => setCart(await loadPreview(items));

  if (!cart) return <p>Cargando el carrito…</p>;
  return (
    <>
      <CartTable
        key={JSON.stringify(cart.items.map((item) => [item.varianteId, item.cantidad]))}
        cart={cart}
        onQuantityChange={(item, cantidad) => update(setGuestQuantity(item.varianteId, cantidad))}
        onRemove={(item) => update(setGuestQuantity(item.varianteId, 0))}
      />
      {cart.items.length > 0 && (
        <p>
          Para comprar, <Link href="/ingresar?next=/carrito">ingresá</Link> o{" "}
          <Link href="/registrarse?next=/carrito">creá una cuenta</Link>: tu carrito se conserva.
        </p>
      )}
    </>
  );
}
