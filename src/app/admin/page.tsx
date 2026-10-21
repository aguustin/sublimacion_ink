import Link from "next/link";
import { requireAdminPage } from "@/app/session";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const admin = await requireAdminPage();
  return (
    <main>
      <h1>Administración</h1>
      <p>Hola, {admin.nombre}.</p>
      <ul>
        <li>
          <Link href="/admin/productos">Productos y variantes</Link>
        </li>
        <li>
          <Link href="/admin/categorias">Categorías</Link>
        </li>
        <li>
          <Link href="/admin/inventario">Inventario y materiales</Link>
        </li>
        <li>
          <Link href="/admin/pedidos">Pedidos</Link>
        </li>
        <li>
          <Link href="/admin/feriados">Feriados (plazo de las reservas)</Link>
        </li>
        <li>
          <Link href="/admin/configuracion">Datos de contacto de la tienda</Link>
        </li>
      </ul>
    </main>
  );
}
