"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";

/** Confirma o cambia la fecha comprometida (RN-14). El navegador convierte la hora local a UTC. */
export function DispatchDateForm({ orderId, hasDate }: { orderId: string; hasDate: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const local = String(form.get("fecha") ?? "");
    const result = await sendJson("PUT", `/api/admin/orders/${orderId}/dispatch-date`, {
      fecha: local ? new Date(local).toISOString() : "",
      motivo: form.get("motivo"),
    });
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  const errors = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <p role="alert">{Object.values(errors).join(" ") || error.mensaje}</p>}
      <label>
        {hasDate ? "Nueva fecha comprometida" : "Fecha comprometida"}
        <input name="fecha" type="datetime-local" required />
      </label>
      {hasDate && (
        <label>
          Motivo del cambio
          <input name="motivo" />
        </label>
      )}
      <button type="submit">{hasDate ? "Cambiar fecha y avisar al cliente" : "Confirmar fecha y avisar al cliente"}</button>
    </form>
  );
}
