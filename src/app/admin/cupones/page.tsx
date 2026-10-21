import { requireAdminPage } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime } from "@/lib/orders";
import { listAdminCoupons } from "@/server/modules/coupons/coupon.service";
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
      <h1>Cupones</h1>
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
      <ul>
        {coupons.map((coupon) => {
          const active = coupon.estado === "ACTIVO" && coupon.venceEn > now;
          return (
            <li key={coupon.id}>
              {coupon.codigo} · {formatPesos(coupon.montoCentavos)} · {coupon.pedidoOrigen.cliente.nombre} ({coupon.pedidoOrigen.cliente.email}) · por
              el pedido #{coupon.pedidoOrigen.numero} · {active || coupon.estado !== "ACTIVO" ? STATUS_LABELS[coupon.estado] : "Vencido"} · vence el{" "}
              {formatDateTime(coupon.venceEn)}
              {coupon.motivoAnulacion && ` · ${coupon.motivoAnulacion}`}
              {active && <VoidCouponForm couponId={coupon.id} />}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
