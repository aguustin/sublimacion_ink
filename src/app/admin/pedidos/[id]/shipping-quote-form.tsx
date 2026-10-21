"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";

/** Cotización del envío (F-10) o aviso de que la tienda no puede enviar (D-49). Una nueva reemplaza la anterior. */
export function ShippingQuoteForm({ orderId, hasQuote }: { orderId: string; hasQuote: boolean }) {
  const router = useRouter();
  const [canShip, setCanShip] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nota = String(form.get("nota") ?? "");
    const pesos = Number(String(form.get("importe") ?? "").replace(",", "."));
    const body = canShip ? { envioPosible: true, importeCentavos: Math.round(pesos * 100), ...(nota && { nota }) } : { envioPosible: false, nota };
    const result = await postJson(`/api/admin/orders/${orderId}/shipping-quote`, body);
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <p role="alert">{Object.values(fieldErrors(error)).join(" ") || error.mensaje}</p>}
      <label>
        <input type="radio" checked={canShip} onChange={() => setCanShip(true)} /> Cotizar el envío
      </label>
      <label>
        <input type="radio" checked={!canShip} onChange={() => setCanShip(false)} /> No podemos enviar a esa dirección
      </label>
      {canShip && (
        <label>
          Costo del envío ($)
          <input name="importe" inputMode="decimal" required />
        </label>
      )}
      <label>
        {canShip ? "Nota para el cliente (opcional)" : "Motivo"}
        <input name="nota" required={!canShip} />
      </label>
      <button type="submit">{hasQuote ? "Reemplazar la cotización y avisar al cliente" : "Enviar la cotización al cliente"}</button>
    </form>
  );
}
