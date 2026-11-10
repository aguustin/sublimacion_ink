import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { priceLabel } from "@/lib/money";
import type { PublicProductSummary } from "@/server/modules/catalog/catalog.service";
import { InkLogo } from "../ui/ink-logo";
import styles from "./product-card.module.css";

/**
 * Tarjeta de producto de la tienda (inicio y catálogo): una tarjeta completa con la foto adentro, la
 * categoría, el nombre y, al pie, el precio con un botón que invita a entrar. Sin foto cargada muestra
 * la marca en tono suave: una superficie intencional, sin imágenes inventadas.
 */
export function ProductCard({ product, imageUrl }: { product: PublicProductSummary; imageUrl?: string }) {
  const custom = product.tipo === "PERSONALIZABLE";
  return (
    <Link href={`/productos/${product.slug}`} className={styles.card}>
      <div className={styles.media}>
        {imageUrl ? (
          // URL firmada de corta duración al almacenamiento privado (16.1); no pasa por el optimizador de imágenes.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" loading="lazy" className={styles.image} />
        ) : (
          <span className={styles.placeholder} aria-hidden="true">
            <InkLogo variant="principal" className={styles.placeholderLogo} title="" />
          </span>
        )}
        {(custom || product.hayStock === false) && (
          <span className={styles.badges}>
            {custom && <span className={`${styles.badge} ${styles.badgeCustom}`}>Personalizable</span>}
            {product.hayStock === false && <span className={`${styles.badge} ${styles.badgeOut}`}>Sin stock</span>}
          </span>
        )}
      </div>
      <div className={styles.body}>
        <span className={styles.category}>{product.categoria.nombre}</span>
        <span className={styles.name}>{product.nombre}</span>
      </div>
      <div className={styles.footer}>
        {custom ? (
          <span className={styles.quote}>
            <Sparkles aria-hidden="true" size={16} />
            Cotizá tu diseño
          </span>
        ) : (
          <span className={styles.price}>{priceLabel(product.precioDesdeCentavos, product.variasPrecios)}</span>
        )}
        <span className={styles.go} aria-hidden="true">
          <ArrowRight size={18} />
        </span>
      </div>
    </Link>
  );
}

/** Grilla de tarjetas: dos columnas en móvil y más según el ancho disponible. */
export function ProductGrid({ products, images }: { products: PublicProductSummary[]; images: Map<string, string> }) {
  return (
    <div className={styles.gridWrap}>
      <ul className={styles.grid}>
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} imageUrl={product.imagenId ? images.get(product.imagenId) : undefined} />
          </li>
        ))}
      </ul>
    </div>
  );
}
