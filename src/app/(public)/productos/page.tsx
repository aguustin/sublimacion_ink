import type { Metadata } from "next";
import Link from "next/link";
import { priceLabel } from "@/lib/money";
import { getFilterOptions, listProducts } from "@/server/modules/catalog/catalog.service";
import { getConfig } from "@/server/shared/config";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(params: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  );
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { q } = single(await searchParams);
  return {
    title: q ? `Resultados para «${q}» · Sublimaciones` : "Productos · Sublimaciones",
    description: "Tazas, remeras, stickers, carteles y más productos sublimados, estándar y personalizados.",
    // Las combinaciones de filtros apuntan a la página principal del catálogo.
    alternates: { canonical: `${getConfig().APP_URL}/productos` },
  };
}

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = single(await searchParams);
  const [{ productos, total, pagina, porPagina }, options] = await Promise.all([listProducts(params), getFilterOptions()]);
  const totalPages = Math.max(1, Math.ceil(total / porPagina));
  const pageHref = (page: number) => `/productos?${new URLSearchParams({ ...params, pagina: String(page) })}`;

  return (
    <main>
      <h1>Productos</h1>

      <form method="get" action="/productos">
        <label>
          Buscar
          <input name="q" type="search" defaultValue={params.q} />
        </label>
        <label>
          Categoría
          <select name="categoria" defaultValue={params.categoria ?? ""}>
            <option value="">Todas</option>
            {options.categorias.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select name="tipo" defaultValue={params.tipo ?? ""}>
            <option value="">Todos</option>
            <option value="ESTANDAR">Estándar</option>
            <option value="PERSONALIZABLE">Personalizable</option>
          </select>
        </label>
        <label>
          Material
          <select name="material" defaultValue={params.material ?? ""}>
            <option value="">Todos</option>
            {options.materiales.map((material) => (
              <option key={material}>{material}</option>
            ))}
          </select>
        </label>
        <label>
          Medida
          <select name="medida" defaultValue={params.medida ?? ""}>
            <option value="">Todas</option>
            {options.medidas.map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <label>
          Precio desde ($)
          <input name="precioMin" type="number" min="0" step="1" defaultValue={params.precioMin} />
        </label>
        <label>
          Precio hasta ($)
          <input name="precioMax" type="number" min="0" step="1" defaultValue={params.precioMax} />
        </label>
        <button type="submit">Filtrar</button> <Link href="/productos">Limpiar</Link>
      </form>

      <p>{total === 1 ? "1 producto" : `${total} productos`}</p>
      {productos.length === 0 ? (
        <p>No encontramos productos con esos filtros.</p>
      ) : (
        <ul>
          {productos.map((product) => (
            <li key={product.id}>
              <Link href={`/productos/${product.slug}`}>{product.nombre}</Link> · {product.categoria.nombre}
              {product.tipo === "PERSONALIZABLE" && " · Personalizable"} ·{" "}
              {priceLabel(product.precioDesdeCentavos, product.variasPrecios)}
              {product.hayStock === false && " · Sin stock"}
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav aria-label="Páginas">
          {pagina > 1 && <Link href={pageHref(pagina - 1)}>Anterior</Link>} Página {pagina} de {totalPages}{" "}
          {pagina < totalPages && <Link href={pageHref(pagina + 1)}>Siguiente</Link>}
        </nav>
      )}
    </main>
  );
}
