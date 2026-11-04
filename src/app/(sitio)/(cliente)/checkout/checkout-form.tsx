"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/api";
import { formatPesos } from "@/lib/money";
import type { CartView } from "@/server/modules/cart/cart.service";
import styles from "./checkout.module.css";

type Address = { id: string; calle: string; ciudad: string; provincia: string; codigoPostal: string };

export function CheckoutForm({ cart, hasPhone, addresses }: { cart: CartView; hasPhone: boolean; addresses: Address[] }) {
  const router = useRouter();
  // Una clave por intento de compra: un doble clic o un reintento no crea dos pedidos (RF-21).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [modalidadCierre, setModalidadCierre] = useState<"ONLINE" | "EFECTIVO">("ONLINE");
  const [modalidadEntrega, setModalidadEntrega] = useState<"RETIRO" | "ENVIO">("RETIRO");
  const [direccionId, setDireccionId] = useState(addresses[0]?.id ?? "");
  const shipping = modalidadEntrega === "ENVIO";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ codigo: string; descuentoCentavos: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const discount = coupon?.descuentoCentavos ?? 0;

  async function applyCoupon() {
    const result = await postJson<{ codigo: string; descuentoCentavos: number }>("/api/coupons/validate", { codigo: couponInput });
    setCoupon(result.ok ? result.data : null);
    setCouponError(result.ok ? null : result.error.mensaje);
  }

  async function confirm() {
    setPending(true);
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        // RN-13: con envío solo se paga online.
        modalidadCierre: shipping ? "ONLINE" : modalidadCierre,
        modalidadEntrega,
        ...(shipping && { direccionId }),
        ...(coupon && { codigoCupon: coupon.codigo }),
        precios: cart.items.map((item) => ({ varianteId: item.varianteId, precioUnitarioCentavos: item.precioUnitarioCentavos })),
      }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setPending(false);
    if (response?.ok) {
      router.push(`/pedidos/${body.pedido.id}`);
      return;
    }
    if (body?.codigo === "PRECIO_CAMBIADO" || body?.codigo === "STOCK_INSUFICIENTE") router.refresh();
    if (body?.codigo === "CUPON_INVALIDO") setCoupon(null);
    setError(body?.mensaje ?? "No pudimos conectarnos. Revisá tu conexión.");
  }

  return (
    <div className={styles.layout}>
      <div className={styles.steps}>
        <fieldset className={styles.step}>
          <legend className="ink-step-title">
            <span className="ink-step-number" aria-hidden="true">
              1
            </span>
            Entrega
          </legend>
          <div className={styles.options}>
            <label className="ink-option">
              <input type="radio" checked={!shipping} onChange={() => setModalidadEntrega("RETIRO")} />
              <span>Retiro en el local</span>
            </label>
            <label className="ink-option">
              <input type="radio" checked={shipping} onChange={() => setModalidadEntrega("ENVIO")} disabled={addresses.length === 0} />
              <span>Envío a domicilio</span>
            </label>
          </div>
          {addresses.length === 0 && (
            <p className={styles.hint}>
              Para pedir envío, agregá una dirección en <Link href="/cuenta">Mi cuenta</Link>.
            </p>
          )}
          {shipping && (
            <>
              <label>
                Dirección
                <select value={direccionId} onChange={(event) => setDireccionId(event.target.value)}>
                  {addresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {address.calle}, {address.ciudad}, {address.provincia} ({address.codigoPostal})
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.hint}>
                La tienda te envía el costo del envío dentro de las 48 horas. Después tenés 48 horas para aceptarlo y pagar online, pasar a retiro en
                el local o cancelar sin cargo. El stock se reserva cuando aceptás.
              </p>
            </>
          )}
        </fieldset>

        {!shipping && (
          <fieldset className={styles.step}>
            <legend className="ink-step-title">
              <span className="ink-step-number" aria-hidden="true">
                2
              </span>
              Pago
            </legend>
            <div className={styles.options}>
              <label className="ink-option">
                <input type="radio" checked={modalidadCierre === "ONLINE"} onChange={() => setModalidadCierre("ONLINE")} />
                <span>Pago online (simulado: no se cobra dinero real). Tenés 30 minutos para completarlo.</span>
              </label>
              <label className="ink-option">
                <input type="radio" checked={modalidadCierre === "EFECTIVO"} onChange={() => setModalidadCierre("EFECTIVO")} disabled={!hasPhone} />
                <span>Reserva para pagar en efectivo en el local, dentro de las 24 horas hábiles (no cuentan fines de semana ni feriados).</span>
              </label>
            </div>
            {!hasPhone && (
              <p className={styles.hint}>
                Para reservar con pago en efectivo necesitamos tu teléfono: agregalo en <Link href="/cuenta">Mi cuenta</Link>.
              </p>
            )}
          </fieldset>
        )}
      </div>

      <aside className={styles.summary} aria-labelledby="checkout-summary">
        <h2 id="checkout-summary">Resumen</h2>
        <ul className={styles.items}>
          {cart.items.map((item) => (
            <li key={item.varianteId}>
              <span>
                {item.producto.nombre} · {item.variante} × {item.cantidad}
              </span>
              <span>{formatPesos((item.precioUnitarioCentavos ?? 0) * item.cantidad)}</span>
            </li>
          ))}
        </ul>

        <details className={styles.coupon} open={coupon !== null || couponError !== null || undefined}>
          <summary>
            ¿Tenés un cupón?
            <ChevronDown aria-hidden="true" size={18} className={styles.couponChevron} />
          </summary>
          <div className={styles.couponBody}>
            <label>
              Código
              <input value={couponInput} onChange={(event) => setCouponInput(event.target.value)} />
            </label>
            <button type="button" onClick={applyCoupon}>
              Aplicar
            </button>
            {coupon && (
              <button type="button" onClick={() => setCoupon(null)}>
                Quitar
              </button>
            )}
          </div>
          {coupon && (
            <p className={styles.hint}>
              Cupón {coupon.codigo}: −{formatPesos(discount)} sobre los productos (sin vuelto ni saldo).
            </p>
          )}
          {couponError && <p role="alert">{couponError}</p>}
        </details>

        <p className={styles.total}>
          <span>{shipping ? "Productos" : "Total"}</span>
          <strong>{formatPesos(cart.subtotalCentavos - discount)}</strong>
        </p>
        <p className={styles.hint}>Precios finales con impuestos incluidos{shipping && "; el envío se suma cuando la tienda lo cotice"}.</p>

        {error && <p role="alert">{error}</p>}
        <button type="button" className={`ink-btn-primary ${styles.confirm}`} onClick={confirm} disabled={pending}>
          {shipping ? "Pedir la cotización del envío" : "Confirmar pedido"}
        </button>
      </aside>
    </div>
  );
}
