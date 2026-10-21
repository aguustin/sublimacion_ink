import type { Metadata } from "next";
import { getPageUser } from "@/app/session";
import { getCart } from "@/server/modules/cart/cart.service";
import { AccountCart } from "./account-cart";
import { GuestCart } from "./guest-cart";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Carrito · Sublimaciones", robots: { index: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const user = await getPageUser();
  const { aviso } = await searchParams;

  return (
    <main>
      <h1>Carrito</h1>
      {aviso === "ajustado" && (
        <p role="status">Algunos productos de tu carrito no tenían stock suficiente: se ajustaron o se quitaron.</p>
      )}
      {user ? <AccountCart initialCart={await getCart(user.id)} /> : <GuestCart />}
    </main>
  );
}
