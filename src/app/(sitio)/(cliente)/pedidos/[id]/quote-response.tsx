"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson, type ApiError } from "@/lib/api";
import { formatPesos } from "@/lib/money";

type Preview = {
  cotizacionId: string;
  precioProductosCentavos: number;
  descuentoCuponCentavos: number;
  costoEnvioCentavos: number;
  totalCentavos: number;
  senaCentavos: number;
};

/** Respuesta a la cotización vigente (F-03 paso 4): aceptar, con cupón opcional, o rechazar. */
export function QuoteResponse({ orderId, shipping, hasPhone }: { orderId: string; shipping: boolean; hasPhone: boolean }) {
  const router = useRouter();
  const [coupon, setCoupon] = useState("");
  const [modalidadCierre, setModalidadCierre] = useState<"ONLINE" | "EFECTIVO">("ONLINE");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function loadPreview() {
    const query = coupon ? `?cupon=${encodeURIComponent(coupon)}` : "";
    const response = await fetch(`/api/custom-orders/${orderId}/quote/preview${query}`).catch(() => null);
    const body = await response?.json().catch(() => null);
    setPreview(response?.ok ? body : null);
    setError(response?.ok ? null : (body ?? { codigo: "SIN_CONEXION", mensaje: "No pudimos conectarnos." }));
  }

  async function respond(action: "accept" | "reject") {
    if (!preview) return;
    const body =
      action === "accept"
        ? {
            cotizacionId: preview.cotizacionId,
            modalidadCierre,
            totalEsperadoCentavos: preview.totalCentavos,
            ...(coupon && { codigoCupon: coupon }),
          }
        : { cotizacionId: preview.cotizacionId };
    const result = await postJson(`/api/custom-orders/${orderId}/quote/${action}`, body);
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
    else void loadPreview();
  }

  return (
    <section aria-label="Responder la cotización">
      {error && <p role="alert">{error.mensaje}</p>}
      <label>
        Cupón (opcional)
        <input value={coupon} onChange={(event) => setCoupon(event.target.value)} />
      </label>{" "}
      <button type="button" onClick={loadPreview}>
        Ver el total
      </button>
      {preview && (
        <>
          <p>
            Productos: {formatPesos(preview.precioProductosCentavos)}
            {preview.descuentoCuponCentavos > 0 && ` · cupón −${formatPesos(preview.descuentoCuponCentavos)}`}
            {preview.costoEnvioCentavos > 0 && ` · envío ${formatPesos(preview.costoEnvioCentavos)}`} · Total:{" "}
            <strong>{formatPesos(preview.totalCentavos)}</strong> · Seña (20 % de los productos, sin envío):{" "}
            <strong>{formatPesos(preview.senaCentavos)}</strong>
          </p>
          <fieldset>
            <legend>Pago de la seña</legend>
            <label>
              <input type="radio" checked={modalidadCierre === "ONLINE"} onChange={() => setModalidadCierre("ONLINE")} /> Online (30 minutos para
              pagar)
            </label>
            {!shipping && (
              <label>
                <input type="radio" checked={modalidadCierre === "EFECTIVO"} onChange={() => setModalidadCierre("EFECTIVO")} disabled={!hasPhone} />{" "}
                En efectivo en el local (24 horas hábiles)
              </label>
            )}
          </fieldset>
          <button type="button" onClick={() => respond("accept")}>
            Aceptar la cotización
          </button>{" "}
          <button type="button" onClick={() => respond("reject")}>
            Rechazarla
          </button>
        </>
      )}
    </section>
  );
}
