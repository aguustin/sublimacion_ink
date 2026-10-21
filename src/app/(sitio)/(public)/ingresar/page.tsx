"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";
import { mergeGuestCartIntoAccount, safeNextPath } from "@/lib/guest-cart";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const result = await postJson("/api/auth/login", { email: form.get("email"), contrasena: form.get("contrasena") });
    if (!result.ok) {
      setPending(false);
      return setError(result.error);
    }
    const merge = await mergeGuestCartIntoAccount();
    router.push(merge.adjusted ? "/carrito?aviso=ajustado" : safeNextPath(next, merge.hadItems ? "/carrito" : "/cuenta"));
    router.refresh();
  }

  const errors = fieldErrors(error);
  const registerHref = next ? `/registrarse?next=${encodeURIComponent(next)}` : "/registrarse";
  return (
    <>
      <form onSubmit={onSubmit} noValidate>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        {errors.email && <p role="alert">{errors.email}</p>}
        <label>
          Contraseña
          <input name="contrasena" type="password" autoComplete="current-password" required />
        </label>
        {errors.contrasena && <p role="alert">{errors.contrasena}</p>}
        {error && !errors.email && !errors.contrasena && <p role="alert">{error.mensaje}</p>}
        <button type="submit" disabled={pending}>
          Ingresar
        </button>
      </form>
      <p>
        <Link href="/recuperar-contrasena">Olvidé mi contraseña</Link> · <Link href={registerHref}>Crear una cuenta</Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <main>
      <h1>Ingresar</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
