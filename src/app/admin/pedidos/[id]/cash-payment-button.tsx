"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/api";

export function CashPaymentButton({ orderId, total }: { orderId: string; total: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function register() {
    if (!window.confirm(`¿Confirmás que recibiste ${total} en efectivo?`)) return;
    setPending(true);
    const result = await postJson(`/api/admin/orders/${orderId}/cash-payment`);
    setPending(false);
    if (!result.ok) return setError(result.error.mensaje);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={register} disabled={pending}>
        Registrar pago en efectivo ({total})
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
