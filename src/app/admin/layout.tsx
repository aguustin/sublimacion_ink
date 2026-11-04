import type { Metadata } from "next";
import type { ReactNode } from "react";
import { inkFont } from "../ui/font";
import "../ui/ink.css";
import { AdminNav } from "./admin-nav";
import styles from "./admin.module.css";

export const metadata: Metadata = { title: "Administración · INK", robots: { index: false, follow: false } };

/**
 * Layout raíz del panel, con el tema oscuro de INK (Documento Maestro, sección 6): el sitio público
 * tiene el suyo en `(sitio)/layout.tsx`, así el panel no hereda la barra pública ni sus márgenes.
 * El acceso se verifica en cada página con requireAdminPage().
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR" className={inkFont.variable}>
      <body className={`ink-admin ${styles.body}`}>
        <div className={styles.shell}>
          <AdminNav />
          <div className={`ink-base ${styles.main}`}>{children}</div>
        </div>
      </body>
    </html>
  );
}
