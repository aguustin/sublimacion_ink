import type { Metadata } from "next";
import { TicketPercent } from "lucide-react";
import { requirePageUser } from "@/app/session";
import { StatusBadge } from "@/app/ui/status-badge";
import { formatPesos } from "@/lib/money";
import { formatDateTime } from "@/lib/orders";
import { COUPON_FAMILY, COUPON_PUBLIC_LABELS } from "@/lib/status";
import { listCustomerCoupons } from "@/server/modules/coupons/coupon.service";
import styles from "./coupons.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mis cupones · Sublimaciones", robots: { index: false } };

/** RF-50: cupones de compensación del cliente, con código, monto, estado y vencimiento (Documento Maestro, 12.3). */
export default async function CouponsPage() {
  const user = await requirePageUser();
  const coupons = await listCustomerCoupons(user.id);

  return (
    <main>
      <h1>Mis cupones</h1>
      {coupons.length === 0 ? (
        <div className={styles.empty}>
          <TicketPercent aria-hidden="true" size={36} />
          <p>No tenés cupones.</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {coupons.map((coupon) => (
            <li key={coupon.id} className={styles.card}>
              <span className={styles.code}>{coupon.codigo}</span>
              <span className={styles.amount}>{formatPesos(coupon.montoCentavos)}</span>
              <StatusBadge family={COUPON_FAMILY[coupon.estado] ?? "neutral"}>{COUPON_PUBLIC_LABELS[coupon.estado] ?? coupon.estado}</StatusBadge>
              <span className={styles.expiry}>Vence el {formatDateTime(coupon.venceEn)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note}>Se usa uno por compra, solo sobre los productos (no sobre el envío), y no deja saldo.</p>
    </main>
  );
}
