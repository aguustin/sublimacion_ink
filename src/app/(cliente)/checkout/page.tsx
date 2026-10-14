import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/app/session";
import { getCart } from "@/server/modules/cart/cart.service";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Finalizar compra · Sublimaciones", robots: { index: false } };

export default async function CheckoutPage() {
  const user = await requirePageUser();
  const cart = await getCart(user.id);
  const blocking = cart.items.some((item) => item.advertencias.some((warning) => warning !== "PRECIO_CAMBIO"));

  return (
    <main>
      <h1>Finalizar compra</h1>
      {cart.items.length === 0 ? (
        <p>
          Tu carrito está vacío. <Link href="/productos">Ver productos</Link>
        </p>
      ) : blocking ? (
        <p>
          Hay productos sin stock suficiente o que ya no están a la venta. <Link href="/carrito">Revisá el carrito</Link>.
        </p>
      ) : (
        <CheckoutForm cart={cart} hasPhone={user.telefono !== null} />
      )}
    </main>
  );
}
