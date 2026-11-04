"use client";

import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { InkLogo, InkWordmark } from "../ui/ink-logo";
import { ADMIN_SECTIONS } from "./admin-sections";
import styles from "./admin.module.css";

// Preferencia de cada administrador en su navegador: barra lateral contraída o expandida.
const COLLAPSED_KEY = "ink-admin-sidebar-collapsed";
const COLLAPSED_EVENT = "ink-admin-sidebar";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(COLLAPSED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COLLAPSED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function storeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Sin almacenamiento (modo privado): la preferencia dura hasta recargar.
  }
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

function Brand({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  return (
    <Link href="/admin" className={`${styles.brand} ${className ?? ""}`} aria-label="INK · Administración">
      {collapsed ? (
        // Marca compacta provisoria (F3): el texto «INK» en amarillo, sin un símbolo nuevo.
        <InkWordmark className={styles.brandCompact} />
      ) : (
        <>
          <InkLogo variant="invertido" className={styles.brandLogo} title="INK" />
          <span className={styles.brandLabel}>Administración</span>
        </>
      )}
    </Link>
  );
}

/**
 * Navegación del panel (Documento Maestro, sección 6): barra lateral negra, expandida o contraída
 * en escritorio, y menú desplegable en tablet y móvil.
 */
export function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <>
      <div className={styles.topbar}>
        <Brand />
        <button type="button" className={styles.menuButton} aria-expanded={open} aria-controls="admin-nav" onClick={() => setOpen((value) => !value)}>
          {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          {open ? "Cerrar menú" : "Menú"}
        </button>
      </div>
      <aside id="admin-nav" className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""} ${collapsed ? styles.sidebarCollapsed : ""}`}>
        <Brand className={styles.sidebarBrand} collapsed={collapsed} />
        <nav className={styles.nav} aria-label="Administración">
          <ul>
            {ADMIN_SECTIONS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={styles.navLink}
                  aria-current={isActive(href) ? "page" : undefined}
                  // Contraída, el nombre queda como etiqueta accesible y como ayuda al pasar el puntero.
                  title={collapsed ? label : undefined}
                  // Al navegar, el menú desplegable se cierra.
                  onClick={() => setOpen(false)}
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={2} className={styles.navIcon} />
                  <span className={styles.navLabel}>{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <button type="button" className={styles.collapseButton} aria-pressed={collapsed} onClick={() => storeCollapsed(!collapsed)}>
          {collapsed ? <PanelLeftOpen aria-hidden="true" size={20} /> : <PanelLeftClose aria-hidden="true" size={20} />}
          <span className={styles.navLabel}>{collapsed ? "Expandir menú" : "Contraer menú"}</span>
        </button>
      </aside>
    </>
  );
}
