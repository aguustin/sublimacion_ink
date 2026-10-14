import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Administración · Sublimaciones", robots: { index: false, follow: false } };

// El acceso se verifica en cada página con requireAdminPage(); el layout solo agrega la navegación.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav>
        <Link href="/admin">Administración</Link> · <Link href="/admin/productos">Productos</Link> ·{" "}
        <Link href="/admin/categorias">Categorías</Link> · <Link href="/admin/inventario">Inventario</Link> ·{" "}
        <Link href="/admin/pedidos">Pedidos</Link>
      </nav>
      {children}
    </>
  );
}
