import type { ReactNode } from "react";
import { ADMIN_SECTIONS } from "./admin-sections";
import styles from "./page-header.module.css";

/**
 * Encabezado de las pantallas del panel: título, descripción y acciones a la derecha (en móvil, debajo).
 * Sin `description`, usa la de la sección en ADMIN_SECTIONS, la misma del inicio.
 */
export function PageHeader({ title, href, description, children }: { title: string; href?: string; description?: ReactNode; children?: ReactNode }) {
  const text = description ?? ADMIN_SECTIONS.find((section) => section.href === href)?.description;
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1>{title}</h1>
        {text && <p className={styles.description}>{text}</p>}
      </div>
      {children && <div className={styles.actions}>{children}</div>}
    </header>
  );
}
