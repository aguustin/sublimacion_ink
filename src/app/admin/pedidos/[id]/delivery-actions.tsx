"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";

type Step = "LISTO_PARA_RETIRO" | "ENTREGADO";

const STEP_LABELS: Record<Step, { button: string; confirm: string }> = {
  LISTO_PARA_RETIRO: { button: "Marcar listo para retirar y avisar al cliente", confirm: "¿El pedido ya está listo para retirar?" },
  ENTREGADO: { button: "Registrar la entrega", confirm: "¿Confirmás que el cliente ya recibió el pedido?" },
};

function ErrorMessage({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return <p role="alert">{Object.values(fieldErrors(error)).join(" ") || error.mensaje}</p>;
}

/** Paso de la entrega sin datos extra (F-06): listo para retirar o entregado. */
export function DeliveryStepButton({ orderId, step }: { orderId: string; step: Step }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    if (!window.confirm(STEP_LABELS[step].confirm)) return;
    setPending(true);
    const result = await sendJson("POST", `/api/admin/orders/${orderId}/transitions`, { estado: step });
    setPending(false);
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <>
      <button type="button" className="ink-btn-primary" onClick={run} disabled={pending}>
        {STEP_LABELS[step].button}
      </button>
      <ErrorMessage error={error} />
    </>
  );
}

/**
 * Despacho de un envío con datos de seguimiento opcionales (RF-43). Con `dispatched`, el mismo
 * formulario corrige el transportista y el código de un envío ya despachado.
 */
export function DispatchForm({
  orderId,
  dispatched,
  transportista,
  codigoSeguimiento,
}: {
  orderId: string;
  dispatched: boolean;
  transportista?: string | null;
  codigoSeguimiento?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const tracking = { transportista: form.get("transportista"), codigoSeguimiento: form.get("codigoSeguimiento") };
    setPending(true);
    const result = dispatched
      ? await sendJson("PATCH", `/api/admin/orders/${orderId}/delivery`, tracking)
      : await sendJson("POST", `/api/admin/orders/${orderId}/transitions`, { estado: "DESPACHADO", ...tracking });
    setPending(false);
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorMessage error={error} />
      <label>
        Transportista (opcional)
        <input name="transportista" maxLength={100} defaultValue={transportista ?? ""} />
      </label>
      <label>
        Código de seguimiento (opcional)
        <input name="codigoSeguimiento" maxLength={100} defaultValue={codigoSeguimiento ?? ""} />
      </label>
      <button type="submit" disabled={pending}>
        {dispatched ? "Guardar el seguimiento" : "Despachar y avisar al cliente"}
      </button>
    </form>
  );
}

/** Compensación por demora (RN-04, D-05): la tienda decide el importe; el sistema genera la devolución. */
export function DelayCompensationForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pesos = String(form.get("importe") ?? "").replace(",", ".");
    if (!window.confirm("¿Registrar la compensación? Se genera la devolución al cliente y se le avisa.")) return;
    setPending(true);
    const result = await sendJson("POST", `/api/admin/orders/${orderId}/adjustments`, {
      importeCentavos: pesos ? Math.round(Number(pesos) * 100) : null,
      justificacion: form.get("justificacion"),
      autorizadoPor: form.get("autorizadoPor"),
    });
    setPending(false);
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorMessage error={error} />
      <label>
        Importe a devolver ($)
        <input name="importe" inputMode="decimal" required />
      </label>
      <label>
        Quién la autorizó
        <input name="autorizadoPor" maxLength={100} required />
      </label>
      <label>
        Motivo (lo ve el cliente)
        <textarea name="justificacion" maxLength={500} required />
      </label>
      <button type="submit" disabled={pending}>
        Registrar la compensación
      </button>
    </form>
  );
}
