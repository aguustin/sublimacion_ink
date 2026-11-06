import { ArrowRight, CreditCard, MessageSquare, Store, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFilterOptions, listProducts } from "@/server/modules/catalog/catalog.service";
import { productImageUrls } from "@/server/modules/catalog/product-images.service";
import { InkLogo } from "../ui/ink-logo";
import styles from "./home.module.css";
import { ProductGrid } from "./product-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sublimaciones · INK",
  description: "Tazas, remeras, stickers, carteles y más productos sublimados, estándar y personalizados.",
};

/** Cuántos productos muestra el inicio: una fila en escritorio, dos en móvil. */
const FEATURED = 4;

// Solo funcionalidades reales del sistema (F15): nada de envíos gratis, promociones ni testimonios.
const BENEFITS = [
  { icon: CreditCard, title: "Pagá como prefieras", text: "Online al confirmar, o reservá y pagá en efectivo en el local." },
  { icon: Truck, title: "Retiro o envío", text: "Retirá en el local o pedí envío: te cotizamos el costo antes de pagar." },
  { icon: MessageSquare, title: "Hablá con la tienda", text: "Seguí tu pedido y consultanos por el chat de tu cuenta." },
];

// El flujo real de un personalizado (F-03, RN-21, RN-07).
const STEPS = [
  { title: "Pedí tu cotización", text: "Elegí el producto, contanos qué querés y adjuntá tus referencias." },
  { title: "Aprobá el diseño", text: "Con la seña te preparamos el diseño, y no se fabrica hasta que lo apruebes." },
  { title: "Recibilo", text: "Lo retirás en el local o te lo enviamos. El saldo se paga al final." },
];

/** Inicio de la tienda (rediseño v1.38): marca, categorías, productos y cómo funciona un personalizado. */
export default async function HomePage() {
  const [{ productos }, { categorias }] = await Promise.all([listProducts({}), getFilterOptions()]);
  const featured = productos.slice(0, FEATURED);
  const images = await productImageUrls(
    featured.flatMap((product) => (product.imagenId ? [product.imagenId] : [])),
    { miniatura: true },
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="inicio-titulo">
        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <span className={styles.heroEyebrow}>Sublimación estándar y personalizada</span>
            <h1 id="inicio-titulo">
              Tus ideas, impresas en lo que <span className={styles.highlight}>usás todos los días</span>.
            </h1>
            <p className={styles.heroLead}>
              Tazas, remeras, stickers, carteles y más. Comprá productos listos o pedí uno con tu diseño: te cotizamos y lo fabricamos cuando lo
              apruebes.
            </p>
            <div className={styles.heroActions}>
              <Link href="/productos" className="ink-btn ink-btn-primary">
                Ver productos
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link href="/productos?tipo=PERSONALIZABLE" className={`ink-btn ${styles.heroSecondary}`}>
                Personalizar un producto
              </Link>
            </div>
          </div>
          <div className={styles.heroArt} aria-hidden="true">
            <InkLogo variant="invertido" className={styles.heroLogo} title="" />
          </div>
        </div>
      </section>

      <ul className={styles.benefits} aria-label="Cómo compramos juntos">
        {BENEFITS.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <span className={styles.benefitIcon}>
              <Icon aria-hidden="true" size={22} />
            </span>
            <span>
              <strong>{title}</strong>
              <span className={styles.benefitText}>{text}</span>
            </span>
          </li>
        ))}
      </ul>

      {categorias.length > 0 && (
        <section aria-labelledby="categorias-titulo" className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <span className="ink-eyebrow">Explorá</span>
              <h2 id="categorias-titulo">Categorías</h2>
            </div>
          </div>
          <ul className={styles.categories}>
            {categorias.map((category) => (
              <li key={category.slug}>
                <Link href={`/productos?categoria=${category.slug}`} className={styles.category}>
                  <span>{category.nombre}</span>
                  <ArrowRight aria-hidden="true" size={20} className={styles.categoryArrow} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {featured.length > 0 && (
        <section aria-labelledby="productos-titulo" className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <span className="ink-eyebrow">Catálogo</span>
              <h2 id="productos-titulo">Nuestros productos</h2>
            </div>
            <Link href="/productos" className={styles.seeAll}>
              Ver todos
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
          <ProductGrid products={featured} images={images} />
        </section>
      )}

      <section aria-labelledby="personalizados-titulo" className={styles.custom}>
        <div className={styles.customHead}>
          <span className="ink-eyebrow">Personalizados</span>
          <h2 id="personalizados-titulo">¿Lo querés con tu diseño?</h2>
          <p>Así funciona un pedido personalizado, de la idea a tus manos.</p>
        </div>
        <ol className={styles.steps}>
          {STEPS.map(({ title, text }, index) => (
            <li key={title}>
              <span className={styles.stepNumber}>{index + 1}</span>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
        <Link href="/productos?tipo=PERSONALIZABLE" className="ink-btn ink-btn-primary">
          <Store aria-hidden="true" size={18} />
          Ver productos personalizables
        </Link>
      </section>
    </main>
  );
}
