"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";

/** Registra una factura o una nota de crédito emitida fuera del sistema; primero sube el PDF si hay (RN-26). */
export function ReceiptForm({ orderId, allowCreditNote }: { orderId: string; allowCreditNote: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    let archivoId: string | undefined;
    const file = form.get("pdf");
    if (file instanceof File && file.size > 0) {
      const data = new FormData();
      data.set("archivo", file);
      data.set("contexto", "COMPROBANTE");
      const response = await fetch("/api/files", { method: "POST", body: data }).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (!response?.ok) {
        setPending(false);
        return setError(body ?? { codigo: "SIN_CONEXION", mensaje: "No pudimos subir el PDF." });
      }
      archivoId = body.archivo.id;
    }
    const number = (name: string) => (form.get(name) ? Number(form.get(name)) : null);
    const pesos = String(form.get("importe") ?? "").replace(",", ".");
    const result = await sendJson("POST", `/api/admin/orders/${orderId}/receipts`, {
      tipo: form.get("tipo"),
      letra: form.get("letra"),
      puntoVenta: number("puntoVenta"),
      numero: number("numero"),
      fechaEmision: form.get("fechaEmision"),
      importeCentavos: pesos ? Math.round(Number(pesos) * 100) : null,
      archivoId,
    });
    setPending(false);
    setError(result.ok ? null : result.error);
    if (result.ok) {
      formElement.reset();
      router.refresh();
    }
  }

  const errors = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <p role="alert">{Object.values(errors).join(" ") || error.mensaje}</p>}
      <label>
        Tipo
        <select name="tipo" defaultValue="FACTURA">
          <option value="FACTURA">Factura</option>
          {allowCreditNote && <option value="NOTA_CREDITO">Nota de crédito</option>}
        </select>
      </label>
      <label>
        Letra
        <input name="letra" defaultValue="C" maxLength={2} required />
      </label>
      <label>
        Punto de venta
        <input name="puntoVenta" type="number" min={1} required />
      </label>
      <label>
        Número
        <input name="numero" type="number" min={1} required />
      </label>
      <label>
        Fecha de emisión
        <input name="fechaEmision" type="date" required />
      </label>
      <label>
        Importe ($)
        <input name="importe" inputMode="decimal" required />
      </label>
      <label>
        PDF del comprobante (opcional)
        <input name="pdf" type="file" accept="application/pdf" />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Registrando…" : "Registrar el comprobante"}
      </button>
    </form>
  );
}
