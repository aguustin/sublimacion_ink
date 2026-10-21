"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, postJson, sendJson, type ApiError, type ApiResult } from "@/lib/api";

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  async function run(request: Promise<ApiResult<unknown>>) {
    const result = await request;
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }
  const message = error && (Object.values(fieldErrors(error)).join(" ") || error.mensaje);
  return { run, alert: message ? <p role="alert">{message}</p> : null };
}

const text = (event: FormEvent<HTMLFormElement>, name: string) => String(new FormData(event.currentTarget).get(name) ?? "");

/** F-05: la tienda cancela sin cargo y con devolución total; corresponde el cupón (RN-19, RN-20). */
export function StoreCancelForm({ orderId }: { orderId: string }) {
  const { run, alert } = useAction();
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (window.confirm("¿Cancelar el pedido? Se devuelve todo lo pagado y corresponde un cupón de compensación.")) {
          void run(postJson(`/api/admin/orders/${orderId}/cancel`, { motivo: text(event, "motivo") }));
        }
      }}
    >
      {alert}
      <label>
        Motivo (lo ve el cliente)
        <input name="motivo" required />
      </label>
      <button type="submit">Cancelar el pedido</button>
    </form>
  );
}

/** RF-42: reembolso online simulado; RN-18: devolución en efectivo arreglada con el cliente. */
export function RefundActions({ refundId, estado }: { refundId: string; estado: string }) {
  const { run, alert } = useAction();
  if (estado === "PENDIENTE") {
    return (
      <>
        {alert}
        <button type="button" onClick={() => run(postJson(`/api/admin/refunds/${refundId}/execute`))}>
          Ejecutar el reembolso (simulado)
        </button>
      </>
    );
  }
  if (estado !== "PENDIENTE_ARREGLO") return null;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void run(postJson(`/api/admin/refunds/${refundId}/close`, { nota: text(event, "nota") }));
      }}
    >
      {alert}
      <label>
        Nota
        <input name="nota" required />
      </label>
      <button type="submit">Marcar como devuelto</button>
    </form>
  );
}

/** RN-18: cierre de un cargo pendiente; RF-53: costo real estimado, solo como referencia. */
export function AdjustmentActions({
  adjustmentId,
  estado,
  costoRealEstimadoCentavos,
}: {
  adjustmentId: string;
  estado: string;
  costoRealEstimadoCentavos: number | null;
}) {
  const { run, alert } = useAction();
  return (
    <>
      {alert}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const pesos = text(event, "costo").replace(",", ".");
          void run(
            sendJson("PATCH", `/api/admin/adjustments/${adjustmentId}`, {
              costoRealEstimadoCentavos: pesos ? Math.round(Number(pesos) * 100) : null,
            }),
          );
        }}
      >
        <label>
          Costo real estimado ($, no cambia el cargo)
          <input name="costo" inputMode="decimal" defaultValue={costoRealEstimadoCentavos === null ? "" : String(costoRealEstimadoCentavos / 100)} />
        </label>
        <button type="submit">Guardar</button>
      </form>
      {estado === "PENDIENTE_ARREGLO" && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void run(postJson(`/api/admin/adjustments/${adjustmentId}/close`, { resultado: text(event, "resultado"), nota: text(event, "nota") }));
          }}
        >
          <label>
            Resultado
            <select name="resultado" defaultValue="COBRADO">
              <option value="COBRADO">Cobrado</option>
              <option value="CONDONADO">Condonado</option>
              <option value="INCOBRABLE">Incobrable</option>
            </select>
          </label>
          <label>
            Nota
            <input name="nota" required />
          </label>
          <button type="submit">Cerrar el cargo</button>
        </form>
      )}
    </>
  );
}
