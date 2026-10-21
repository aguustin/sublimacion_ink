import type { Metadata } from "next";
import { Nunito_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { AdminNav } from "./admin-nav";
import styles from "./admin.module.css";

export const metadata: Metadata = { title: "Administración · INK", robots: { index: false, follow: false } };

// Tipografía redondeada de INK, servida por Next (sin dependencias nuevas).
const nunito = Nunito_Sans({ subsets: ["latin"], variable: "--font-ink", display: "swap" });

/**
 * Layout raíz del panel: el sitio público tiene el suyo en `(sitio)/layout.tsx`, así el panel no
 * hereda la barra pública ni sus márgenes. El acceso se verifica en cada página con requireAdminPage().
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body className={styles.body}>
        <div className={`${styles.shell} ${nunito.variable}`}>
          <AdminNav />
          <div className={styles.main}>{children}</div>
        </div>
      </body>
    </html>
  );
}
