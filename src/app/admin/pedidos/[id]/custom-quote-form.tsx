"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";

/** Cotización manual (D-10): emitirla o reemplazarla, o reemitirla en un pedido nuevo (D-42). */
export function CustomQuoteForm({ orderId, shipping, mode }: { orderId: string; shipping: boolean; mode: "quote" | "reissue" }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cents = (name: string) => Math.round(Number(String(form.get(name) ?? "").replace(",", ".")) * 100);
    const body = {
      precioUnitarioCentavos: cents("precio"),
      ...(shipping && { costoEnvioCentavos: cents("envio") }),
      fechaEntregaPropuesta: form.get("fecha"),
      detalle: form.get("detalle"),
    };
    const url = mode === "quote" ? `/api/admin/custom-orders/${orderId}/quote` : `/api/admin/custom-orders/${orderId}/reissue-quote`;
    const result = await postJson<{ pedidoId?: string }>(url, body);
    setError(result.ok ? null : result.error);
    if (!result.ok) return;
    if (mode === "reissue" && result.data.pedidoId) router.push(`/admin/pedidos/${result.data.pedidoId}`);
    else router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <p role="alert">{Object.values(fieldErrors(error)).join(" ") || error.mensaje}</p>}
      <label>
        Precio por unidad ($)
        <input name="precio" inputMode="decimal" required />
      </label>
      {shipping && (
        <label>
          Costo del envío ($, se cobra con el saldo)
          <input name="envio" inputMode="decimal" required />
        </label>
      )}
      <label>
        Fecha estimada de entrega
        <input name="fecha" type="date" required />
      </label>
      <label>
        Detalle
        <textarea name="detalle" required />
      </label>
      <button type="submit">{mode === "quote" ? "Enviar la cotización al cliente" : "Reemitir en un pedido nuevo"}</button>
    </form>
  );
}
