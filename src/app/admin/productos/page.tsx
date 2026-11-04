import { Plus } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { listAdminProducts } from "@/server/modules/catalog/catalog-admin.service";
import { PageHeader } from "../page-header";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const { productos, total } = await listAdminProducts(params);

  return (
    <main>
      <PageHeader title="Productos" href="/admin/productos">
        <Link href="/admin/productos/nuevo" className="ink-btn ink-btn-primary">
          <Plus aria-hidden="true" size={18} />
          Nuevo producto
        </Link>
      </PageHeader>
      <form method="get">
        <label>
          Buscar
          <input name="q" type="search" defaultValue={params.q} />
        </label>
        <button type="submit">Buscar</button>
      </form>
      <p>{total} productos (incluye inactivos)</p>
      <table className="ink-table-cards">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Categoría</th>
            <th>Tipo</th>
            <th>Variantes</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((product) => (
            <tr key={product.id}>
              <td>
                <Link href={`/admin/productos/${product.id}`}>{product.nombre}</Link>
              </td>
              <td data-label="Categoría">{product.categoria.nombre}</td>
              <td data-label="Tipo">{product.tipo === "ESTANDAR" ? "Estándar" : "Personalizable"}</td>
              <td data-label="Variantes">{product._count.variantes}</td>
              <td data-label="Estado">{product.activo ? "Activo" : "Inactivo"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
