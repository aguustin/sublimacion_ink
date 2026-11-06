import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { InkLogo } from "../ui/ink-logo";
import { inkFont } from "../ui/font";
import "../ui/ink.css";
import { SiteNav } from "./site-nav";
import styles from "./site.module.css";

export const metadata: Metadata = {
  title: "Sublimaciones",
  description: "Productos sublimados estándar y personalizados.",
};

/** Layout raíz de la tienda, con el tema claro de INK (Documento Maestro, sección 5). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR" className={inkFont.variable}>
      <body className={`ink-public ${styles.body}`}>
        <SiteNav />
        <div className={`ink-base ${styles.main}`}>{children}</div>
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <div className={styles.footerBrand}>
              <InkLogo variant="invertido" className={styles.footerLogo} />
              <p>Productos sublimados estándar y personalizados: tazas, remeras, stickers, carteles y más.</p>
            </div>
            {/* Solo destinos reales (F15). */}
            <nav aria-label="Pie de página" className={styles.footerColumns}>
              <div>
                <p className={styles.footerTitle}>Tienda</p>
                <ul className={styles.footerLinks}>
                  <li>
                    <Link href="/productos">Productos</Link>
                  </li>
                  <li>
                    <Link href="/productos?tipo=PERSONALIZABLE">Personalizados</Link>
                  </li>
                  <li>
                    <Link href="/carrito">Carrito</Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className={styles.footerTitle}>Tu cuenta</p>
                <ul className={styles.footerLinks}>
                  <li>
                    <Link href="/pedidos">Mis pedidos</Link>
                  </li>
                  <li>
                    <Link href="/mensajes">Mensajes</Link>
                  </li>
                  <li>
                    <Link href="/contacto">Contacto</Link>
                  </li>
                </ul>
              </div>
            </nav>
            <p className={styles.footerBottom}>© {new Date().getFullYear()} INK · Precios finales en pesos, con impuestos incluidos.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
