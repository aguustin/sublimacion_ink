"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CancellationBreakdown } from "@/app/cancellation-breakdown";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";

type Preview = Parameters<typeof CancellationBreakdown>[0]["breakdown"];

/** Cancelación por el cliente (F-04): primero la vista previa con el desglose, después la confirmación. */
export function CancelOrder({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function loadPreview() {
    const response = await fetch(`/api/orders/${orderId}/cancellation-preview`).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (response?.ok) {
      setPreview({ regla: body.regla, dentroVentana: body.dentroVentana, ...body.desglose });
      setError(null);
    } else {
      setError(body ?? { codigo: "SIN_CONEXION", mensaje: "No pudimos conectarnos." });
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await postJson(`/api/orders/${orderId}/cancel`, {
      motivo: new FormData(event.currentTarget).get("motivo"),
      cargoEsperadoCentavos: preview!.cargoCentavos,
      aReembolsarEsperadoCentavos: preview!.aReembolsarCentavos,
    });
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
    else if (result.error.codigo === "CONDICIONES_CAMBIARON") void loadPreview();
  }

  const message = error && (Object.values(fieldErrors(error)).join(" ") || error.mensaje);
  if (!preview) {
    return (
      <>
        {message && <p role="alert">{message}</p>}
        <button type="button" onClick={loadPreview}>
          Cancelar el pedido
        </button>
      </>
    );
  }
  return (
    <form onSubmit={confirm} noValidate>
      {message && <p role="alert">{message}</p>}
      <p>Si cancelás ahora:</p>
      <CancellationBreakdown breakdown={preview} />
      <label>
        Motivo
        <input name="motivo" required />
      </label>
      <button type="submit">Confirmar la cancelación</button>{" "}
      <button type="button" onClick={() => setPreview(null)}>
        Volver
      </button>
    </form>
  );
}
