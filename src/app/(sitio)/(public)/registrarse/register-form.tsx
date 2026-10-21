"use client";

import { useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";
import { mergeGuestCartIntoAccount } from "@/lib/guest-cart";

export type RegisterOutcome = Awaited<ReturnType<typeof mergeGuestCartIntoAccount>>;

/**
 * Registro en un solo paso (RN-25): crea la cuenta, inicia la sesión y pasa a la cuenta el
 * carrito del navegador. Lo usan `/registrarse` y el checkout.
 */
export function RegisterForm({ onRegistered, phoneHint }: { onRegistered: (outcome: RegisterOutcome) => void; phoneHint?: string }) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const result = await postJson("/api/auth/register", {
      nombre: form.get("nombre"),
      email: form.get("email"),
      contrasena: form.get("contrasena"),
      telefono: form.get("telefono"),
    });
    if (!result.ok) {
      setPending(false);
      return setError(result.error);
    }
    onRegistered(await mergeGuestCartIntoAccount());
  }

  const errors = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} noValidate>
      <label>
        Nombre
        <input name="nombre" autoComplete="name" required />
      </label>
      {errors.nombre && <p role="alert">{errors.nombre}</p>}
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      {errors.email && <p role="alert">{errors.email}</p>}
      <label>
        Contraseña
        <input name="contrasena" type="password" autoComplete="new-password" required />
      </label>
      {errors.contrasena && <p role="alert">{errors.contrasena}</p>}
      <label>
        Teléfono {phoneHint ?? "(opcional)"}
        <input name="telefono" type="tel" autoComplete="tel" />
      </label>
      {errors.telefono && <p role="alert">{errors.telefono}</p>}
      {error && Object.keys(errors).length === 0 && <p role="alert">{error.mensaje}</p>}
      <button type="submit" disabled={pending}>
        Crear cuenta
      </button>
    </form>
  );
}
