import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { listAdminProducts } from "@/server/modules/catalog/catalog-admin.service";

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
      <h1>Productos</h1>
      <p>
        <Link href="/admin/productos/nuevo">Nuevo producto</Link>
      </p>
      <form method="get">
        <label>
          Buscar
          <input name="q" type="search" defaultValue={params.q} />
        </label>
        <button type="submit">Buscar</button>
      </form>
      <p>{total} productos (incluye inactivos)</p>
      <table>
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
              <td>{product.categoria.nombre}</td>
              <td>{product.tipo === "ESTANDAR" ? "Estándar" : "Personalizable"}</td>
              <td>{product._count.variantes}</td>
              <td>{product.activo ? "Activo" : "Inactivo"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
