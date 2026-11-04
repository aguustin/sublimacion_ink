import { requireAdminPage } from "@/app/session";
import { StatusBadge } from "@/app/ui/status-badge";
import { COUPON_FAMILY } from "@/lib/status";
import { formatPesos } from "@/lib/money";
import { formatDateTime } from "@/lib/orders";
import { listAdminCoupons } from "@/server/modules/coupons/coupon.service";
import { PageHeader } from "../page-header";
import { VoidCouponForm } from "./void-coupon-form";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = { ACTIVO: "Activo", USADO: "Usado", VENCIDO: "Vencido", ANULADO: "Anulado" };

/** RF-54: cupones emitidos, filtro por estado y anulación con motivo. */
export default async function AdminCouponsPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  await requireAdminPage();
  const params = await searchParams;
  const coupons = await listAdminCoupons(params);
  const now = new Date();

  return (
    <main>
      <PageHeader title="Cupones" href="/admin/cupones" />
      <form method="get">
        <label>
          Estado
          <select name="estado" defaultValue={params.estado ?? ""}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filtrar</button>
      </form>
      {coupons.length === 0 ? (
        <p>{params.estado ? "No hay cupones con ese estado." : "Todavía no se emitieron cupones."}</p>
      ) : (
        <table className="ink-table-cards">
          <thead>
            <tr>
              <th>Código</th>
              <th>Monto</th>
              <th>Cliente</th>
              <th>Pedido de origen</th>
              <th>Estado</th>
              <th>Vence</th>
              <th>Motivo de anulación</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {coupons.map((coupon) => {
              const active = coupon.estado === "ACTIVO" && coupon.venceEn > now;
              return (
                <tr key={coupon.id}>
                  <td>{coupon.codigo}</td>
                  <td data-label="Monto">{formatPesos(coupon.montoCentavos)}</td>
                  <td data-label="Cliente">
                    {coupon.pedidoOrigen.cliente.nombre} ({coupon.pedidoOrigen.cliente.email})
                  </td>
                  <td data-label="Pedido de origen">#{coupon.pedidoOrigen.numero}</td>
                  <td data-label="Estado">
                    {active || coupon.estado !== "ACTIVO" ? (
                      <StatusBadge family={COUPON_FAMILY[coupon.estado] ?? "neutral"}>{STATUS_LABELS[coupon.estado] ?? coupon.estado}</StatusBadge>
                    ) : (
                      <StatusBadge family="neutral">Vencido</StatusBadge>
                    )}
                  </td>
                  <td data-label="Vence">{formatDateTime(coupon.venceEn)}</td>
                  <td data-label="Motivo de anulación">{coupon.motivoAnulacion ?? ""}</td>
                  <td>{active && <VoidCouponForm couponId={coupon.id} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
