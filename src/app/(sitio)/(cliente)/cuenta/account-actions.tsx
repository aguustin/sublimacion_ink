"use client";

import { LogOut, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/api";
import styles from "./account.module.css";

/** Reenvía el email de confirmación (solo se muestra si falta confirmar). */
export function ResendVerification() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function resend() {
    setPending(true);
    const result = await postJson<{ mensaje: string }>("/api/auth/resend-verification");
    setPending(false);
    setMessage(result.ok ? result.data.mensaje : result.error.mensaje);
  }

  return (
    <div className={styles.actions}>
      <button type="button" className="ink-btn-primary" onClick={resend} disabled={pending}>
        <MailCheck aria-hidden="true" size={18} />
        Reenviar el email
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await postJson("/api/auth/logout");
    router.push("/ingresar");
    router.refresh();
  }

  return (
    <button type="button" className={styles.logout} onClick={logout}>
      <LogOut aria-hidden="true" size={18} />
      Cerrar sesión
    </button>
  );
}
