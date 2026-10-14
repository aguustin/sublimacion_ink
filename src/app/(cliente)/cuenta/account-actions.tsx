"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/api";

export function AccountActions({ emailVerificado }: { emailVerificado: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  async function resendVerification() {
    const result = await postJson<{ mensaje: string }>("/api/auth/resend-verification");
    setMessage(result.ok ? result.data.mensaje : result.error.mensaje);
  }

  async function logout() {
    await postJson("/api/auth/logout");
    router.push("/ingresar");
    router.refresh();
  }

  return (
    <div>
      {!emailVerificado && (
        <button type="button" onClick={resendVerification}>
          Reenviar el email de confirmación
        </button>
      )}
      {message && <p>{message}</p>}
      <button type="button" onClick={logout}>
        Cerrar sesión
      </button>
    </div>
  );
}
