"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { postJson } from "@/lib/api";

// La confirmación requiere un clic: si se hiciera al abrir el enlace, los antivirus de correo
// que abren los enlaces automáticamente consumirían el token.
function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    const result = await postJson<{ mensaje: string }>("/api/auth/verify-email", { token });
    setPending(false);
    setMessage(result.ok ? result.data.mensaje : "El enlace no es válido o ya venció. Podés pedir otro desde tu cuenta.");
  }

  if (message) {
    return (
      <p>
        {message} <Link href="/cuenta">Ir a mi cuenta</Link>
      </p>
    );
  }
  return (
    <button type="button" onClick={confirm} disabled={pending}>
      Confirmar mi email
    </button>
  );
}

export default function VerifyEmailPage() {
  return (
    <main>
      <h1>Confirmar email</h1>
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </main>
  );
}
