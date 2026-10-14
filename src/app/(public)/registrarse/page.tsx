"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";
import { mergeGuestCartIntoAccount, safeNextPath } from "@/lib/guest-cart";

function RegisterForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
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
    const merge = await mergeGuestCartIntoAccount();
    router.push(merge.adjusted ? "/carrito?aviso=ajustado" : safeNextPath(next, merge.hadItems ? "/carrito" : "/cuenta"));
    router.refresh();
  }

  const errors = fieldErrors(error);
  return (
    <>
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
          Teléfono (opcional)
          <input name="telefono" type="tel" autoComplete="tel" />
        </label>
        {errors.telefono && <p role="alert">{errors.telefono}</p>}
        {error && Object.keys(errors).length === 0 && <p role="alert">{error.mensaje}</p>}
        <button type="submit" disabled={pending}>
          Crear cuenta
        </button>
      </form>
      <p>
        ¿Ya tenés cuenta? <Link href={next ? `/ingresar?next=${encodeURIComponent(next)}` : "/ingresar"}>Ingresá</Link>
      </p>
    </>
  );
}

export default function RegisterPage() {
  return (
    <main>
      <h1>Crear una cuenta</h1>
      <Suspense>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
