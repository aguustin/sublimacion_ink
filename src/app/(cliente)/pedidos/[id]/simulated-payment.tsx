"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/api";

type Result = "APROBADO" | "RECHAZADO" | "ERROR";

/** Pasarela SIMULADA (RN-09, CA-15): no cobra dinero; permite elegir el resultado para probar el flujo. */
export function SimulatedPayment({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function pay(resultado: Result) {
    setPending(true);
    const result = await postJson<{ confirmado: boolean }>(`/api/payments/simulated/${orderId}`, { resultado });
    setPending(false);
    if (!result.ok) return setMessage(result.error.mensaje);
    setMessage(result.data.confirmado ? "Pago aprobado." : "El pago no se aprobó. Podés intentar de nuevo.");
    router.refresh();
  }

  return (
    <section aria-label="Pago simulado">
      <h2>PAGO SIMULADO</h2>
      <p>Esta es una simulación: no se cobra dinero real. Elegí el resultado del pago.</p>
      <button type="button" onClick={() => pay("APROBADO")} disabled={pending}>
        Aprobar
      </button>{" "}
      <button type="button" onClick={() => pay("RECHAZADO")} disabled={pending}>
        Rechazar
      </button>{" "}
      <button type="button" onClick={() => pay("ERROR")} disabled={pending}>
        Simular error
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
