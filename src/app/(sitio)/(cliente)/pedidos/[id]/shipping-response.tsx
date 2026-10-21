"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/api";
import { formatPesos } from "@/lib/money";

type Props = {
  orderId: string;
  cotizacionId: string;
  /** Nulo: la tienda no puede enviar a esa dirección (D-49). */
  costoEnvioCentavos: number | null;
  nota: string | null;
  subtotalProductosCentavos: number;
  /** Cupón del pedido sobre los productos a precio de hoy (RN-20). */
  descuentoCuponCentavos: number;
  hayStock: boolean;
  hasPhone: boolean;
};

/** Respuesta a la cotización del envío (F-10, D-47): aceptar y pagar online, pasar a retiro o cancelar sin cargo. */
export function ShippingResponse({
  orderId,
  cotizacionId,
  costoEnvioCentavos,
  nota,
  subtotalProductosCentavos,
  descuentoCuponCentavos,
  hayStock,
  hasPhone,
}: Props) {
  const productos = subtotalProductosCentavos - descuentoCuponCentavos;
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send(path: string, body?: unknown) {
    setPending(true);
    const result = await postJson(`/api/orders/${orderId}/shipping/${path}`, body);
    setPending(false);
    if (!result.ok) setMessage(result.error.mensaje);
    router.refresh();
  }

  const cannotShip = costoEnvioCentavos === null;
  return (
    <section aria-label="Cotización del envío">
      <h2>Envío</h2>
      {cannotShip ? (
        <p>La tienda no puede enviar el pedido a tu dirección{nota && `: ${nota}`}.</p>
      ) : (
        <>
          <p>
            Productos (precios de hoy{descuentoCuponCentavos > 0 && `, con −${formatPesos(descuentoCuponCentavos)} de cupón`}):{" "}
            {formatPesos(productos)} · Envío: {formatPesos(costoEnvioCentavos)}
            {nota && ` (${nota})`} · Total: <strong>{formatPesos(productos + costoEnvioCentavos)}</strong>
          </p>
          <button
            type="button"
            disabled={pending || !hayStock}
            onClick={() => send("accept", { cotizacionId, totalEsperadoCentavos: productos + costoEnvioCentavos })}
          >
            Aceptar y pagar online
          </button>
        </>
      )}
      {!hayStock && <p>Hoy no hay stock suficiente de algún producto o ya no está a la venta.</p>}
      <h3>Retirar en el local</h3>
      <p>Total sin envío: {formatPesos(productos)}</p>
      <button
        type="button"
        disabled={pending || !hayStock}
        onClick={() => send("pickup", { modalidadCierre: "ONLINE", totalEsperadoCentavos: productos })}
      >
        Retirar y pagar online
      </button>{" "}
      <button
        type="button"
        disabled={pending || !hayStock || !hasPhone}
        onClick={() => send("pickup", { modalidadCierre: "EFECTIVO", totalEsperadoCentavos: productos })}
      >
        Retirar y pagar en efectivo
      </button>
      {!hasPhone && <p>Para pagar en efectivo necesitamos tu teléfono: agregalo en Mi cuenta.</p>}
      <h3>Cancelar</h3>
      <button type="button" disabled={pending} onClick={() => confirm("¿Cancelar el pedido? No tiene cargo.") && send("decline")}>
        Cancelar el pedido sin cargo
      </button>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
