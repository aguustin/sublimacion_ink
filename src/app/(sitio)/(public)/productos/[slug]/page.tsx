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
    <main>
      <script
        type="application/ld+json"
        // JSON.stringify con "<" escapado: el contenido no puede cerrar la etiqueta script.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(product, url)).replace(/</g, "\\u003c") }}
      />
      <p>
        <Link href="/productos">Productos</Link> › <Link href={`/productos?categoria=${product.categoria.slug}`}>{product.categoria.nombre}</Link>
      </p>
      <h1>{product.nombre}</h1>
      {product.imagenIds.map(
        (imageId, index) =>
          images.has(imageId) && (
            // URL firmada de corta duración al almacenamiento privado (16.1).
            // eslint-disable-next-line @next/next/no-img-element
            <img key={imageId} src={images.get(imageId)} alt={index === 0 ? product.nombre : ""} width={320} height={320} />
          ),
      )}
      {product.tipo === "PERSONALIZABLE" && (
        <p>
          Producto personalizable: <Link href={`/personalizados/nuevo?producto=${product.slug}`}>pedí tu cotización</Link>.
        </p>
      )}
      <p>{priceLabel(product.precioDesdeCentavos, product.variasPrecios)}</p>
      {product.descripcion && <p>{product.descripcion}</p>}

      <h2>Variantes</h2>
      <table>
        <thead>
          <tr>
            <th>Opción</th>
            <th>Precio</th>
            {product.tipo === "ESTANDAR" && (
              <>
                <th>Disponibilidad</th>
                <th />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {product.variantes.map((variant) => (
            <tr key={variant.id}>
              <td>{describe(variant)}</td>
              <td>{variant.precioCentavos === null ? "Consultá el precio" : formatPesos(variant.precioCentavos)}</td>
              {variant.disponible !== null && (
                <>
                  <td>{variant.disponible > 0 ? "Disponible" : "Sin stock"}</td>
                  <td>
                    <AddToCart varianteId={variant.id} disponible={variant.disponible} loggedIn={loggedIn} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p>Precios finales en pesos, con impuestos incluidos.</p>
    </main>
  );
}
