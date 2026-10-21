import type { Metadata } from "next";
import { requirePageUser } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime } from "@/lib/orders";
import { listCustomerCoupons } from "@/server/modules/coupons/coupon.service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mis cupones · Sublimaciones", robots: { index: false } };

const STATUS_LABELS: Record<string, string> = { ACTIVO: "Disponible", USADO: "Usado", VENCIDO: "Vencido", ANULADO: "Anulado" };

/** RF-50: cupones de compensación del cliente. */
export default async function CouponsPage() {
  const user = await requirePageUser();
  const coupons = await listCustomerCoupons(user.id);

  return (
    <main>
      <h1>Mis cupones</h1>
      {coupons.length === 0 ? (
        <p>No tenés cupones.</p>
      ) : (
        <ul>
          {coupons.map((coupon) => (
            <li key={coupon.id}>
              <strong>{coupon.codigo}</strong> · {formatPesos(coupon.montoCentavos)} · {STATUS_LABELS[coupon.estado]} · vence el{" "}
              {formatDateTime(coupon.venceEn)}
            </li>
          ))}
        </ul>
      )}
      <p>Se usa uno por compra, solo sobre los productos (no sobre el envío), y no deja saldo.</p>
    </main>
  );
}
