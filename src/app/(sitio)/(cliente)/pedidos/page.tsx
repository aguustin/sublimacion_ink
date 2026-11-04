import type { Metadata } from "next";
import { ChevronRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { requirePageUser } from "@/app/session";
import { StatusBadge } from "@/app/ui/status-badge";
import { formatPesos } from "@/lib/money";
import { formatDateTime } from "@/lib/orders";
import { ORDER_FAMILY, orderPublicLabel } from "@/lib/status";
import { listCustomerOrders } from "@/server/modules/orders/orders.service";
import styles from "./orders.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mis pedidos · Sublimaciones", robots: { index: false } };

/** Mis pedidos (Documento Maestro, 5.6): filas en escritorio y tarjetas en móvil, con el texto público del estado (12.3). */
export default async function OrdersPage() {
  const user = await requirePageUser();
  const orders = await listCustomerOrders(user.id);

  return (
    <main>
      <h1>Mis pedidos</h1>
      {orders.length === 0 ? (
        <div className={styles.empty}>
          <ClipboardList aria-hidden="true" size={36} />
          <p>Todavía no hiciste pedidos.</p>
          <Link href="/productos" className="ink-btn ink-btn-primary">
            Ver productos
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={`/pedidos/${order.id}`} className={styles.row}>
                <span className={styles.number}>Pedido #{order.numero}</span>
                <span className={styles.date}>{formatDateTime(order.creadoEn)}</span>
                <span className={styles.status}>
                  <StatusBadge family={ORDER_FAMILY[order.estado] ?? "neutral"}>
                    {orderPublicLabel(order.estado, order.tipo, order.historial[0]?.motivo)}
                  </StatusBadge>
                </span>
                <span className={styles.total}>{formatPesos(order.totalCentavos)}</span>
                <ChevronRight aria-hidden="true" size={20} className={styles.chevron} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
