import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime, ORDER_STATUS_LABELS } from "@/lib/orders";
import { listCustomerOrders } from "@/server/modules/orders/orders.service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mis pedidos · Sublimaciones", robots: { index: false } };

export default async function OrdersPage() {
  const user = await requirePageUser();
  const orders = await listCustomerOrders(user.id);

  return (
    <main>
      <h1>Mis pedidos</h1>
      {orders.length === 0 ? (
        <p>
          Todavía no hiciste pedidos. <Link href="/productos">Ver productos</Link>
        </p>
      ) : (
        <ul>
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={`/pedidos/${order.id}`}>Pedido #{order.numero}</Link> · {formatDateTime(order.creadoEn)} ·{" "}
              {ORDER_STATUS_LABELS[order.estado]} · {formatPesos(order.totalCentavos)}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
