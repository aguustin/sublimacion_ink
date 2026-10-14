"use client";

import { useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await postJson<{ mensaje: string }>("/api/auth/forgot-password", {
      email: new FormData(event.currentTarget).get("email"),
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setError(null);
    setMessage(result.data.mensaje);
  }

  const errors = fieldErrors(error);
  return (
    <main>
      <h1>Recuperar la contraseña</h1>
      {message ? (
        <p>{message}</p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          {errors.email && <p role="alert">{errors.email}</p>}
          {error && !errors.email && <p role="alert">{error.mensaje}</p>}
          <button type="submit" disabled={pending}>
            Enviar enlace
          </button>
        </form>
      )}
    </main>
  );
}
