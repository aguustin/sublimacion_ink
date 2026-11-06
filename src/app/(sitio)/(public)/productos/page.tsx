import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, ImageOff, SearchX, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { priceLabel } from "@/lib/money";
import { getFilterOptions, listProducts } from "@/server/modules/catalog/catalog.service";
import { productImageUrls } from "@/server/modules/catalog/product-images.service";
import { getConfig } from "@/server/shared/config";
import styles from "./catalog.module.css";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(params: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])));
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
  const images = await productImageUrls(
    productos.flatMap((product) => (product.imagenId ? [product.imagenId] : [])),
    { miniatura: true },
  );
  const totalPages = Math.max(1, Math.ceil(total / porPagina));
  const pageHref = (page: number) => `/productos?${new URLSearchParams({ ...params, pagina: String(page) })}`;

  const hasFilters = Object.keys(params).some((key) => key !== "pagina");

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <h1>Productos</h1>
        <p className={styles.count}>{total === 1 ? "1 producto" : `${total} productos`}</p>
      </div>

      <div className={styles.layout}>
        {/* Filtros: panel lateral en escritorio; en móvil, desplegable (Documento Maestro, 5.3). */}
        <details className={styles.filters} open={hasFilters || undefined}>
          <summary className={styles.filtersSummary}>
            <SlidersHorizontal aria-hidden="true" size={18} />
            Filtros
          </summary>
          <form method="get" action="/productos" className={styles.filtersForm}>
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
            <div className={styles.priceRange}>
              <label>
                Precio desde ($)
                <input name="precioMin" type="number" min="0" step="1" defaultValue={params.precioMin} />
              </label>
              <label>
                Precio hasta ($)
                <input name="precioMax" type="number" min="0" step="1" defaultValue={params.precioMax} />
              </label>
            </div>
            <div className={styles.filterActions}>
              <button type="submit">Filtrar</button>
              {hasFilters && <Link href="/productos">Limpiar filtros</Link>}
            </div>
          </form>
        </details>

        <section className={styles.results} aria-label="Resultados">
          {productos.length === 0 ? (
            <div className={styles.empty}>
              <SearchX aria-hidden="true" size={32} />
              <p>No encontramos productos con esos filtros.</p>
              {hasFilters && (
                <Link href="/productos" className="ink-btn">
                  Ver todos los productos
                </Link>
              )}
            </div>
          ) : (
            <ul className={styles.grid}>
              {productos.map((product) => (
                <li key={product.id}>
                  <Link href={`/productos/${product.slug}`} className={styles.card}>
                    <div className={styles.media}>
                      {product.imagenId && images.has(product.imagenId) ? (
                        // URL firmada de corta duración al almacenamiento privado (16.1); no pasa por el optimizador de imágenes.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={images.get(product.imagenId)} alt="" loading="lazy" className={styles.image} />
                      ) : (
                        // Sin foto cargada: una superficie neutra, sin imágenes inventadas.
                        <ImageOff aria-hidden="true" size={32} className={styles.noImage} />
                      )}
                    </div>
                    <div className={styles.body}>
                      <span className={styles.category}>{product.categoria.nombre}</span>
                      <span className={styles.name}>{product.nombre}</span>
                      <span className={styles.price}>{priceLabel(product.precioDesdeCentavos, product.variasPrecios)}</span>
                      <span className={styles.tags}>
                        {product.tipo === "PERSONALIZABLE" && <span className={styles.tag}>Personalizable</span>}
                        {product.hayStock === false && <span className={styles.tag}>Sin stock</span>}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <nav aria-label="Páginas" className={styles.pagination}>
              {pagina > 1 ? (
                <Link href={pageHref(pagina - 1)} className="ink-btn">
                  <ChevronLeft aria-hidden="true" size={18} />
                  Anterior
                </Link>
              ) : (
                <span />
              )}
              <span>
                Página {pagina} de {totalPages}
              </span>
              {pagina < totalPages ? (
                <Link href={pageHref(pagina + 1)} className="ink-btn">
                  Siguiente
                  <ChevronRight aria-hidden="true" size={18} />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
