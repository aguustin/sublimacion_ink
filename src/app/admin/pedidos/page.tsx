import Link from "next/link";
import { StatusBadge } from "@/app/ui/status-badge";
import { ORDER_FAMILY } from "@/lib/status";
import { requireAdminPage } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime, ORDER_STATUS_LABELS } from "@/lib/orders";
import { listAdminOrders } from "@/server/modules/orders/orders.service";
import { PageHeader } from "../page-header";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ estado?: string; pagina?: string }> }) {
  await requireAdminPage();
  const params = await searchParams;
  const { pedidos, total } = await listAdminOrders(params);

  return (
    <main>
      <PageHeader title="Pedidos" href="/admin/pedidos" />
      <form method="get">
        <label>
          Estado
          <select name="estado" defaultValue={params.estado ?? ""}>
            <option value="">Todos</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filtrar</button>
      </form>
      <p>{total} pedidos</p>
      <table className="ink-table-cards">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Estado</th>
            <th>Vence</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.map((order) => (
            <tr key={order.id}>
              <td>
                <Link href={`/admin/pedidos/${order.id}`}>#{order.numero}</Link>
              </td>
              <td data-label="Fecha">{formatDateTime(order.creadoEn)}</td>
              <td data-label="Cliente">{order.cliente.nombre}</td>
              <td data-label="Estado">
                <StatusBadge family={ORDER_FAMILY[order.estado] ?? "neutral"}>{ORDER_STATUS_LABELS[order.estado] ?? order.estado}</StatusBadge>
              </td>
              <td data-label="Vence">
                {order.venceEn && (order.estado === "PENDIENTE_PAGO" || order.estado === "RESERVADO") ? formatDateTime(order.venceEn) : ""}
              </td>
              <td data-label="Total">{formatPesos(order.totalCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
