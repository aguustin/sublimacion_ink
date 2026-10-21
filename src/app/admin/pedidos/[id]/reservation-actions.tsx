"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";
import { formatPesos } from "@/lib/money";

function ErrorMessage({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return <p role="alert">{Object.values(fieldErrors(error)).join(" ") || error.mensaje}</p>;
}

/** Extender una reserva vigente (RN-28). La hora local del navegador se envía en UTC. */
export function ExtendReservationForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const local = String(form.get("venceEn") ?? "");
    const result = await sendJson("POST", `/api/admin/orders/${orderId}/extend-reservation`, {
      venceEn: local ? new Date(local).toISOString() : "",
      motivo: form.get("motivo"),
    });
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorMessage error={error} />
      <label>
        Nuevo vencimiento
        <input name="venceEn" type="datetime-local" required />
      </label>
      <label>
        Motivo
        <input name="motivo" required />
      </label>
      <button type="submit">Extender la reserva y avisar al cliente</button>
    </form>
  );
}

type Preview = {
  items: {
    itemId: string;
    descripcion: string;
    cantidad: number;
    precioAnteriorCentavos: number;
    precioVigenteCentavos: number | null;
    disponible: number;
    aLaVenta: boolean;
  }[];
  descuentoCuponCentavos: number;
  cuponDisponible: boolean;
  totalCentavos: number;
  puedeReactivarse: boolean;
};

/** Reactivar una reserva vencida: primero la vista previa a precios vigentes, después la confirmación. */
export function ReactivateReservation({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function loadPreview() {
    const response = await fetch(`/api/admin/orders/${orderId}/reactivate`).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (response?.ok) {
      setPreview(body);
      setError(null);
    } else {
      setError(body ?? { codigo: "SIN_CONEXION", mensaje: "No pudimos conectarnos." });
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await sendJson("POST", `/api/admin/orders/${orderId}/reactivate`, {
      motivo: new FormData(event.currentTarget).get("motivo"),
      totalEsperadoCentavos: preview!.totalCentavos,
    });
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
    else if (result.error.codigo === "PRECIO_CAMBIADO") void loadPreview();
  }

  if (!preview) {
    return (
      <>
        <ErrorMessage error={error} />
        <button type="button" onClick={loadPreview}>
          Ver la reactivación
        </button>
      </>
    );
  }

  return (
    <form onSubmit={confirm} noValidate>
      <ErrorMessage error={error} />
      <ul>
        {preview.items.map((item) => (
          <li key={item.itemId}>
            {item.descripcion} × {item.cantidad} · {item.precioVigenteCentavos === null ? "sin precio" : formatPesos(item.precioVigenteCentavos)}
            {item.precioVigenteCentavos !== item.precioAnteriorCentavos && ` (antes ${formatPesos(item.precioAnteriorCentavos)})`} ·{" "}
            {!item.aLaVenta ? "ya no está a la venta" : item.disponible >= item.cantidad ? "hay stock" : `solo ${item.disponible} disponibles`}
          </li>
        ))}
      </ul>
      <p>
        {preview.descuentoCuponCentavos > 0 && `Cupón: −${formatPesos(preview.descuentoCuponCentavos)} · `}
        Total a precios vigentes: <strong>{formatPesos(preview.totalCentavos)}</strong>
      </p>
      {preview.puedeReactivarse ? (
        <>
          <label>
            Motivo
            <input name="motivo" required />
          </label>
          <button type="submit">Reactivar la reserva y avisar al cliente</button>
        </>
      ) : (
        <p>
          No se puede reactivar:{" "}
          {preview.cuponDisponible ? "falta stock o algún producto ya no está a la venta." : "el cupón que usaba el pedido ya no está disponible."}
        </p>
      )}
    </form>
  );
}
