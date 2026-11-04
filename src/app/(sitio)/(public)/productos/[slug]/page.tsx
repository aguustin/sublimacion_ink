import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPageUser } from "@/app/session";
import { formatPesos, priceLabel } from "@/lib/money";
import { getProductBySlug, type PublicProductDetail } from "@/server/modules/catalog/catalog.service";
import { productImageUrls } from "@/server/modules/catalog/product-images.service";
import { getConfig } from "@/server/shared/config";
import { AppError } from "@/server/shared/errors";
import { AddToCart } from "./add-to-cart";
import { ProductGallery } from "./product-gallery";
import styles from "./product.module.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

// La metadata y la página piden el mismo producto: se consulta una sola vez por solicitud.
const findProduct = cache(async (slug: string): Promise<PublicProductDetail | null> => {
  try {
    return await getProductBySlug(slug);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const product = await findProduct((await params).slug);
  if (!product) return { title: "Producto no encontrado · Sublimaciones" };
  const url = `${getConfig().APP_URL}/productos/${product.slug}`;
  const description = product.descripcion.slice(0, 160) || `${product.nombre} en la categoría ${product.categoria.nombre}.`;
  return {
    title: `${product.nombre} · Sublimaciones`,
    description,
    alternates: { canonical: url },
    openGraph: { title: product.nombre, description, url, type: "website" },
  };
}

/** Datos estructurados para buscadores; solo los productos estándar tienen precio publicado. */
function structuredData(product: PublicProductDetail, url: string) {
  const prices = product.variantes.flatMap((variant) => (variant.precioCentavos === null ? [] : [variant.precioCentavos]));
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.nombre,
    description: product.descripcion || undefined,
    category: product.categoria.nombre,
    url,
    ...(prices.length > 0 && {
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "ARS",
        lowPrice: (Math.min(...prices) / 100).toFixed(2),
        highPrice: (Math.max(...prices) / 100).toFixed(2),
        offerCount: prices.length,
        availability: product.hayStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      },
    }),
  };
}

const describe = (variant: PublicProductDetail["variantes"][number]) =>
  [variant.material, variant.medida, variant.color, variant.talle].filter(Boolean).join(" · ") || "Única";

export default async function ProductPage({ params }: { params: Params }) {
  const product = await findProduct((await params).slug);
  if (!product) notFound();
  const url = `${getConfig().APP_URL}/productos/${product.slug}`;
  const images = await productImageUrls(product.imagenIds);
  const loggedIn = (await getPageUser()) !== null;

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        // JSON.stringify con "<" escapado: el contenido no puede cerrar la etiqueta script.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(product, url)).replace(/</g, "\\u003c") }}
      />
      <nav aria-label="Ubicación" className={styles.breadcrumb}>
        <ol>
          <li>
            <Link href="/productos">Productos</Link>
          </li>
          <li>
            <Link href={`/productos?categoria=${product.categoria.slug}`}>{product.categoria.nombre}</Link>
          </li>
        </ol>
      </nav>

      <div className={styles.layout}>
        <ProductGallery images={product.imagenIds.flatMap((imageId) => images.get(imageId) ?? [])} name={product.nombre} />

        <div className={styles.info}>
          <section className={styles.buy} aria-labelledby="product-name">
            <p className={styles.category}>{product.categoria.nombre}</p>
            <h1 id="product-name">{product.nombre}</h1>
            <p className={styles.price}>{priceLabel(product.precioDesdeCentavos, product.variasPrecios)}</p>

            {product.tipo === "PERSONALIZABLE" && (
              <div className={styles.custom}>
                <p>Producto personalizable: lo cotizamos según tu diseño.</p>
                <Link href={`/personalizados/nuevo?producto=${product.slug}`} className="ink-btn ink-btn-primary">
                  Pedí tu cotización
                </Link>
              </div>
            )}

            <h2 className={styles.variantsTitle}>{product.variantes.length === 1 ? "Opción" : "Opciones"}</h2>
            <ul className={styles.variants}>
              {product.variantes.map((variant) => (
                <li key={variant.id} className={styles.variant}>
                  <span className={styles.variantInfo}>
                    <span className={styles.variantName}>{describe(variant)}</span>
                    <span className={styles.variantMeta}>
                      {variant.precioCentavos === null ? "Consultá el precio" : formatPesos(variant.precioCentavos)}
                      {variant.disponible !== null && (
                        <>
                          {" · "}
                          {variant.disponible > 0 ? "Disponible" : <span className={styles.soldOut}>Sin stock</span>}
                        </>
                      )}
                    </span>
                  </span>
                  {variant.disponible !== null && <AddToCart varianteId={variant.id} disponible={variant.disponible} loggedIn={loggedIn} />}
                </li>
              ))}
            </ul>
            {product.tipo === "ESTANDAR" && <p className={styles.note}>Precios finales en pesos, con impuestos incluidos.</p>}
          </section>

          {product.descripcion && (
            <section className={styles.description} aria-labelledby="product-description">
              <h2 id="product-description">Descripción</h2>
              <p>{product.descripcion}</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
