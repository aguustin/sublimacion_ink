import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { getFilterOptions, listProducts } from "@/server/modules/catalog/catalog.service";
import { productImageUrls } from "@/server/modules/catalog/product-images.service";
import { getConfig } from "@/server/shared/config";
import { ProductGrid } from "../../product-card";
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
  // Enlace al catálogo con un filtro cambiado (o quitado con `undefined`); siempre vuelve a la página 1.
  const withParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    next.delete("pagina");
    if (value === undefined) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    return query ? `/productos?${query}` : "/productos";
  };
  const moreFilters = ["material", "medida", "precioMin", "precioMax"].filter((key) => params[key]).length;
  const TYPES = [
    { value: undefined, label: "Todos" },
    { value: "ESTANDAR", label: "Listos para comprar" },
    { value: "PERSONALIZABLE", label: "Personalizables" },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className="ink-eyebrow">Catálogo</span>
          <h1>{params.q ? `Resultados para «${params.q}»` : "Productos"}</h1>
          <p className={styles.count}>{total === 1 ? "1 producto" : `${total} productos`}</p>
        </div>
        {/* Buscador grande: conserva los demás filtros. */}
        <form method="get" action="/productos" role="search" className={styles.searchForm}>
          {Object.entries(params)
            .filter(([key]) => key !== "q" && key !== "pagina")
            .map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
          <Search aria-hidden="true" size={20} className={styles.searchIcon} />
          <label className={styles.srOnly} htmlFor="catalog-search">
            Buscar en el catálogo
          </label>
          <input
            id="catalog-search"
            name="q"
            type="search"
            defaultValue={params.q}
            placeholder="¿Qué estás buscando?"
            className={styles.searchInput}
          />
          <button type="submit" className={styles.searchButton}>
            Buscar
          </button>
        </form>
      </header>

      <div className={styles.toolbar}>
        {/* Filtros rápidos de un toque: categoría y tipo. */}
        <nav aria-label="Categorías" className={styles.chips}>
          <Link href={withParam("categoria", undefined)} className={styles.chip} aria-current={!params.categoria ? "page" : undefined}>
            Todo
          </Link>
          {options.categorias.map((category) => (
            <Link
              key={category.slug}
              href={withParam("categoria", category.slug)}
              className={styles.chip}
              aria-current={params.categoria === category.slug ? "page" : undefined}
            >
              {category.nombre}
            </Link>
          ))}
        </nav>
        <nav aria-label="Tipo de producto" className={styles.segmented}>
          {TYPES.map((type) => (
            <Link
              key={type.label}
              href={withParam("tipo", type.value)}
              className={styles.segment}
              aria-current={(params.tipo ?? undefined) === type.value ? "page" : undefined}
            >
              {type.label}
            </Link>
          ))}
        </nav>

        <details className={styles.more} open={moreFilters > 0 || undefined}>
          <summary className={styles.moreSummary}>
            <SlidersHorizontal aria-hidden="true" size={18} />
            Más filtros
            {moreFilters > 0 && <span className={styles.moreCount}>{moreFilters}</span>}
          </summary>
          <form method="get" action="/productos" className={styles.moreForm}>
            {["q", "categoria", "tipo"]
              .filter((key) => params[key])
              .map((key) => (
                <input key={key} type="hidden" name={key} value={params[key]} />
              ))}
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
              <input name="precioMin" type="number" min="0" step="1" inputMode="numeric" placeholder="0" defaultValue={params.precioMin} />
            </label>
            <label>
              Precio hasta ($)
              <input name="precioMax" type="number" min="0" step="1" inputMode="numeric" placeholder="Sin tope" defaultValue={params.precioMax} />
            </label>
            <div className={styles.moreActions}>
              <button type="submit">Aplicar filtros</button>
              {hasFilters && (
                <Link href="/productos" className={styles.clear}>
                  <X aria-hidden="true" size={16} />
                  Limpiar todo
                </Link>
              )}
            </div>
          </form>
        </details>
      </div>

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
          <ProductGrid products={productos} images={images} />
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
    </main>
  );
}
