"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "./admin.module.css";

const LINKS = [
  { href: "/admin", label: "Inicio" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/productos", label: "Productos" },
  { href: "/admin/categorias", label: "Categorías" },
  { href: "/admin/inventario", label: "Inventario" },
  { href: "/admin/cupones", label: "Cupones" },
  { href: "/admin/feriados", label: "Feriados" },
  { href: "/admin/fechas-excluidas", label: "Fechas excluidas" },
  { href: "/admin/correos", label: "Correos fallidos" },
  { href: "/admin/configuracion", label: "Configuración" },
];

/** Gota de tinta del logotipo. */
export function InkMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 2.5c4.6 6.3 10 11.6 10 17.4A10 10 0 0 1 6 19.9C6 14.1 11.4 8.8 16 2.5Z" fill="currentColor" />
      <path d="M11.6 20.6a4.6 4.6 0 0 0 4.4 4" fill="none" stroke="#1c1b1b" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <Link href="/admin" className={`${styles.brand} ${className ?? ""}`}>
      <InkMark className={styles.brandMark} />
      <span>
        INK <small>taller</small>
      </span>
    </Link>
  );
}

/** Navegación del panel: barra lateral persistente en pantallas grandes y menú desplegable en tablet y móvil. */
export function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <>
      <div className={styles.topbar}>
        <Brand />
        <button type="button" className={styles.menuButton} aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((value) => !value)}>
          {open ? "Cerrar menú" : "Menú"}
        </button>
      </div>
      <aside id="admin-nav" className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
        <Brand className={styles.sidebarBrand} />
        <nav className={styles.nav} aria-label="Administración">
          <ul>
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={styles.navLink}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  // Al navegar, el menú desplegable se cierra.
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
