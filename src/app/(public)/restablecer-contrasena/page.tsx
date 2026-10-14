"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await postJson<{ mensaje: string }>("/api/auth/reset-password", {
      token,
      contrasena: new FormData(event.currentTarget).get("contrasena"),
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setMessage(result.data.mensaje);
  }

  if (message) {
    return (
      <p>
        {message} <Link href="/ingresar">Ingresar</Link>
      </p>
    );
  }

  const errors = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} noValidate>
      <label>
        Contraseña nueva
        <input name="contrasena" type="password" autoComplete="new-password" required />
      </label>
      {errors.contrasena && <p role="alert">{errors.contrasena}</p>}
      {error && !errors.contrasena && (
        <p role="alert">
          {error.codigo === "VALIDACION" ? "El enlace no es válido. Pedí uno nuevo." : error.mensaje}{" "}
          <Link href="/recuperar-contrasena">Pedir otro enlace</Link>
        </p>
      )}
      <button type="submit" disabled={pending}>
        Guardar contraseña
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main>
      <h1>Elegí una contraseña nueva</h1>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
