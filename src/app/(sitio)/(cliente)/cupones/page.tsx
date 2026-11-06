import type { Metadata } from "next";
import { TicketPercent } from "lucide-react";
import Link from "next/link";
import { requirePageUser } from "@/app/session";
import { StatusBadge } from "@/app/ui/status-badge";
import { formatPesos } from "@/lib/money";
import { formatDateTime } from "@/lib/orders";
import { COUPON_FAMILY, COUPON_PUBLIC_LABELS } from "@/lib/status";
import { listCustomerCoupons } from "@/server/modules/coupons/coupon.service";
import { AccountNav } from "../account-nav";
import header from "../account-page.module.css";
import { CopyCode } from "./copy-code";
import styles from "./coupons.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mis cupones · Sublimaciones", robots: { index: false } };

/** Cupones del cliente como tickets: monto, código para copiar, estado y vencimiento. */
export default async function CouponsPage() {
  const user = await requirePageUser();
  const coupons = await listCustomerCoupons(user.id);

  return (
    <main>
      <AccountNav />
      <header className={header.header}>
        <h1>Mis cupones</h1>
        <p>Se usa uno por compra, solo sobre los productos (no sobre el envío), y no deja saldo.</p>
      </header>
      {coupons.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <TicketPercent size={28} />
          </span>
          <p>Todavía no tenés cupones</p>
          <span>Si la tienda tiene que cancelar un pedido tuyo, te damos un cupón para tu próxima compra. Lo vas a ver acá.</span>
          <Link href="/productos" className="ink-btn ink-btn-primary">
            Ver productos
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {coupons.map((coupon) => {
            const usable = coupon.estado === "ACTIVO";
            return (
              <li key={coupon.id} className={styles.ticket} data-inactive={!usable || undefined}>
                <div className={styles.value}>
                  <span className={styles.valueLabel}>Cupón de</span>
                  <span className={styles.amount}>{formatPesos(coupon.montoCentavos)}</span>
                </div>
                <div className={styles.details}>
                  <div className={styles.codeRow}>
                    <code className={styles.code}>{coupon.codigo}</code>
                    {usable && <CopyCode code={coupon.codigo} />}
                  </div>
                  <span className={styles.meta}>
                    <StatusBadge family={COUPON_FAMILY[coupon.estado] ?? "neutral"}>
                      {COUPON_PUBLIC_LABELS[coupon.estado] ?? coupon.estado}
                    </StatusBadge>
                    Vence el {formatDateTime(coupon.venceEn)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
