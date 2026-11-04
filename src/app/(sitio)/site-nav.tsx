"use client";

import { Menu, Search, ShoppingCart, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CART_CHANGED_EVENT, readGuestCart } from "@/lib/guest-cart";
import { InkLogo } from "../ui/ink-logo";
import styles from "./site.module.css";

const LINKS = [
  { href: "/productos", label: "Productos" },
  { href: "/contacto", label: "Contacto" },
];

type CartCount = { items: { cantidad: number }[] };

/**
 * Unidades en el carrito para el contador del encabezado (Documento Maestro, 5.1): el de la cuenta si
 * hay sesión (la API responde 401 sin ella) o, si no, el del navegador. Se vuelve a leer al cambiar de
 * página y cada vez que el carrito avisa un cambio.
 */
function useCartCount(pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      let total: number;
      try {
        const response = await fetch("/api/cart", { cache: "no-store" });
        total = response.ok
          ? ((await response.json()) as CartCount).items.reduce((sum, item) => sum + item.cantidad, 0)
          : readGuestCart().reduce((sum, item) => sum + item.cantidad, 0);
      } catch {
        total = readGuestCart().reduce((sum, item) => sum + item.cantidad, 0);
      }
      if (active) setCount(total);
    }
    load();
    window.addEventListener(CART_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(CART_CHANGED_EVENT, load);
    };
  }, [pathname]);
  return count;
}

/**
 * Navegación pública (Documento Maestro, 5.1): barra negra con el logo a la izquierda, enlaces al
 * centro, buscador del catálogo y accesos a la cuenta y al carrito. En móvil, los enlaces van en un
 * menú oscuro. Iconos de lucide-react (F10), siempre con su etiqueta.
 */
export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const cartCount = useCartCount(pathname);

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <button type="button" className={styles.menuButton} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((value) => !value)}>
          {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          {open ? "Cerrar" : "Menú"}
        </button>
        <Link href="/" className={styles.brand} aria-label="INK · Inicio">
          <InkLogo variant="invertido" className={styles.logo} />
        </Link>
        <nav id="site-menu" aria-label="Principal" className={`${styles.links} ${open ? styles.linksOpen : ""}`}>
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={styles.link}
              aria-current={isActive(link.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {/* Buscador integrado: usa la búsqueda que ya tiene el catálogo (parámetro q). */}
        <form action="/productos" method="get" role="search" className={styles.search}>
          <label className={styles.srOnly} htmlFor="site-search">
            Buscar productos
          </label>
          <Search aria-hidden="true" size={18} className={styles.searchIcon} />
          <input id="site-search" name="q" type="search" placeholder="Buscar productos" className={styles.searchInput} />
        </form>
        <div className={styles.actions}>
          <Link href="/cuenta" className={styles.action} aria-current={isActive("/cuenta") ? "page" : undefined}>
            <User aria-hidden="true" size={20} />
            <span className={styles.actionLabel}>Mi cuenta</span>
          </Link>
          <Link href="/carrito" className={`${styles.action} ${styles.cart}`} aria-current={isActive("/carrito") ? "page" : undefined}>
            <ShoppingCart aria-hidden="true" size={20} />
            <span className={styles.actionLabel}>Carrito</span>
            {cartCount > 0 && (
              <span className={styles.cartCount}>
                {cartCount > 99 ? "99+" : cartCount}
                <span className={styles.srOnly}>{cartCount === 1 ? " unidad" : " unidades"}</span>
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
