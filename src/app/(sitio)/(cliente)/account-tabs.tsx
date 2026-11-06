"use client";

import { ClipboardList, MessageSquare, TicketPercent, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./account-tabs.module.css";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/pedidos", label: "Pedidos", icon: ClipboardList },
  { href: "/mensajes", label: "Mensajes", icon: MessageSquare },
  { href: "/cupones", label: "Cupones", icon: TicketPercent },
  { href: "/cuenta", label: "Cuenta", icon: UserRound },
];

/**
 * Navegación del área del cliente (rediseño v1.38): las cuatro secciones a un toque, con la actual
 * marcada. En móvil se desliza de costado dentro de su propia barra.
 */
export function AccountTabs({ unread }: { unread: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Tu cuenta" className={styles.tabs}>
      <ul>
        {TABS.map(({ href, label, icon: Icon }) => {
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link href={href} className={styles.tab} aria-current={current ? "page" : undefined}>
                <Icon aria-hidden="true" size={18} />
                {label}
                {href === "/mensajes" && unread > 0 && (
                  <span className={styles.badge}>
                    {unread}
                    <span className={styles.srOnly}> sin leer</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
