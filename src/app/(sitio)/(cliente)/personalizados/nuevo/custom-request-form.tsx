"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, type ApiError } from "@/lib/api";
import styles from "./custom-request.module.css";

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

  const errors = fieldErrors(error);
  // Mensaje de validación junto a su campo (Documento Maestro, 5.6); el control queda marcado como inválido.
  const invalid = (name: string) => (errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});
  const fieldError = (name: string) =>
    errors[name] && (
      <span id={`${name}-error`} className={styles.fieldError}>
        {errors[name]}
      </span>
    );

  return (
    <form onSubmit={onSubmit} noValidate className={styles.form}>
      {error && Object.keys(errors).length === 0 && <p role="alert">{error.mensaje}</p>}

      <fieldset>
        <legend className="ink-step-title">
          <span className="ink-step-number" aria-hidden="true">
            1
          </span>
          Tu pedido
        </legend>
        <label>
          Opción (medida y material)
          <select name="varianteId" required {...invalid("varianteId")}>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
          {fieldError("varianteId")}
        </label>
        <label>
          Cantidad
          <input name="cantidad" type="number" min={1} max={1000} defaultValue={1} required {...invalid("cantidad")} />
          {fieldError("cantidad")}
        </label>
        <label>
          Fecha deseada
          <input name="fechaDeseada" type="date" required {...invalid("fechaDeseada")} />
          {fieldError("fechaDeseada")}
        </label>
        <label>
          Qué querés
          <textarea name="descripcion" minLength={10} maxLength={2000} required {...invalid("descripcion")} />
          <span className={styles.hint}>Contanos el diseño, los colores y cualquier detalle que tengamos que saber (mínimo 10 caracteres).</span>
          {fieldError("descripcion")}
        </label>
      </fieldset>

      <fieldset>
        <legend className="ink-step-title">
          <span className="ink-step-number" aria-hidden="true">
            2
          </span>
          Entrega
        </legend>
        <label className="ink-option">
          <input type="radio" checked={!shipping} onChange={() => setShipping(false)} />
          <span>Retiro en el local</span>
        </label>
        <label className="ink-option">
          <input type="radio" checked={shipping} onChange={() => setShipping(true)} disabled={addresses.length === 0} />
          <span>Envío (se cotiza junto con el producto)</span>
        </label>
        {addresses.length === 0 && (
          <p className={styles.hint}>
            Para pedir envío, agregá una dirección en <Link href="/cuenta">Mi cuenta</Link>.
          </p>
        )}
        {shipping && (
          <label>
            Dirección
            <select name="direccionId" {...invalid("direccionId")}>
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.label}
                </option>
              ))}
            </select>
            {fieldError("direccionId")}
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend className="ink-step-title">
          <span className="ink-step-number" aria-hidden="true">
            3
          </span>
          Referencias
        </legend>
        <label>
          Archivos de referencia (opcional)
          <input name="referencias" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" {...invalid("referencias")} />
          <span className={styles.hint}>JPG, PNG, WEBP o PDF; hasta 10 archivos.</span>
          {fieldError("referencias")}
        </label>
      </fieldset>

      <div className={styles.submit}>
        <button type="submit" disabled={pending}>
          {pending ? "Enviando…" : "Enviar la solicitud"}
        </button>
      </div>
    </form>
  );
}
