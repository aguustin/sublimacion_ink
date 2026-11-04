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
            <InkLogo variant="invertido" className={styles.footerLogo} />
            {/* Solo destinos reales (F15). */}
            <nav aria-label="Pie de página" className={styles.footerLinks}>
              <Link href="/productos">Productos</Link>
              <Link href="/contacto">Contacto</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
