"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, type ApiError } from "@/lib/api";

type Option = { id: string; label: string };

/** Sube las referencias (contexto REFERENCIA, 16.1) y después crea la solicitud con sus ids. */
export function CustomRequestForm({ variants, addresses }: { variants: Option[]; addresses: Option[] }) {
  const router = useRouter();
  // Una clave por intento: un doble envío no crea dos solicitudes.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [shipping, setShipping] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function post(url: string, init: RequestInit) {
    const response = await fetch(url, { method: "POST", ...init }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok) throw body ?? { codigo: "SIN_CONEXION", mensaje: "No pudimos conectarnos." };
    return body;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      const referencias: string[] = [];
      for (const file of form.getAll("referencias")) {
        if (!(file instanceof File) || file.size === 0) continue;
        const data = new FormData();
        data.set("archivo", file);
        data.set("contexto", "REFERENCIA");
        referencias.push((await post("/api/files", { body: data })).archivo.id);
      }
      const body = await post("/api/custom-orders", {
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          varianteId: form.get("varianteId"),
          cantidad: Number(form.get("cantidad")),
          descripcion: form.get("descripcion"),
          fechaDeseada: form.get("fechaDeseada"),
          modalidadEntrega: shipping ? "ENVIO" : "RETIRO",
          ...(shipping && { direccionId: form.get("direccionId") }),
          referencias,
        }),
      });
      router.push(`/pedidos/${body.pedido.id}`);
    } catch (failure) {
      setError(failure as ApiError);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <p role="alert">{Object.values(fieldErrors(error)).join(" ") || error.mensaje}</p>}
      <label>
        Opción (medida y material)
        <select name="varianteId" required>
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cantidad
        <input name="cantidad" type="number" min={1} max={1000} defaultValue={1} required />
      </label>
      <label>
        Qué querés
        <textarea name="descripcion" minLength={10} maxLength={2000} required />
      </label>
      <label>
        Fecha deseada
        <input name="fechaDeseada" type="date" required />
      </label>
      <fieldset>
        <legend>Entrega</legend>
        <label>
          <input type="radio" checked={!shipping} onChange={() => setShipping(false)} /> Retiro en el local
        </label>
        <label>
          <input type="radio" checked={shipping} onChange={() => setShipping(true)} disabled={addresses.length === 0} /> Envío (se cotiza junto con el
          producto)
        </label>
        {shipping && (
          <select name="direccionId">
            {addresses.map((address) => (
              <option key={address.id} value={address.id}>
                {address.label}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      <label>
        Archivos de referencia (JPG, PNG, WEBP o PDF; hasta 10)
        <input name="referencias" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" />
      </label>
      <button type="submit" disabled={pending}>
        Enviar la solicitud
      </button>
    </form>
  );
}
