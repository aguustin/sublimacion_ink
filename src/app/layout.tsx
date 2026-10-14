import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sublimaciones",
  description: "Productos sublimados estándar y personalizados.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>
        <header>
          <Link href="/">Sublimaciones</Link> · <Link href="/productos">Productos</Link> ·{" "}
          <Link href="/carrito">Carrito</Link> · <Link href="/cuenta">Mi cuenta</Link>
        </header>
        {children}
      </body>
    </html>
  );
}
