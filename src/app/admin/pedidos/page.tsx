import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime, ORDER_STATUS_LABELS } from "@/lib/orders";
import { listAdminOrders } from "@/server/modules/orders/orders.service";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ estado?: string; pagina?: string }> }) {
  await requireAdminPage();
  const params = await searchParams;
  const { pedidos, total } = await listAdminOrders(params);

  return (
    <main>
      <h1>Pedidos</h1>
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
      <table>
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
              <td>{formatDateTime(order.creadoEn)}</td>
              <td>{order.cliente.nombre}</td>
              <td>{ORDER_STATUS_LABELS[order.estado]}</td>
              <td>{order.venceEn && (order.estado === "PENDIENTE_PAGO" || order.estado === "RESERVADO") ? formatDateTime(order.venceEn) : ""}</td>
              <td>{formatPesos(order.totalCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
