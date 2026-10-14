"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPesos } from "@/lib/money";
import type { CartView } from "@/server/modules/cart/cart.service";

export function CheckoutForm({ cart, hasPhone }: { cart: CartView; hasPhone: boolean }) {
  const router = useRouter();
  // Una clave por intento de compra: un doble clic o un reintento no crea dos pedidos (RF-21).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [modalidadCierre, setModalidadCierre] = useState<"ONLINE" | "EFECTIVO">("ONLINE");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        modalidadCierre,
        modalidadEntrega: "RETIRO",
        precios: cart.items.map((item) => ({ varianteId: item.varianteId, precioUnitarioCentavos: item.precioUnitarioCentavos })),
      }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setPending(false);
    if (response?.ok) {
      router.push(`/pedidos/${body.pedido.id}`);
      return;
    }
    if (body?.codigo === "PRECIO_CAMBIADO" || body?.codigo === "STOCK_INSUFICIENTE") router.refresh();
    setError(body?.mensaje ?? "No pudimos conectarnos. Revisá tu conexión.");
  }

  return (
    <>
      <ul>
        {cart.items.map((item) => (
          <li key={item.varianteId}>
            {item.producto.nombre} · {item.variante} × {item.cantidad} = {formatPesos((item.precioUnitarioCentavos ?? 0) * item.cantidad)}
          </li>
        ))}
      </ul>
      <p>
        Total: <strong>{formatPesos(cart.subtotalCentavos)}</strong> (precios finales con impuestos incluidos).
      </p>

      <fieldset>
        <legend>Entrega</legend>
        <label>
          <input type="radio" checked readOnly /> Retiro en el local
        </label>
        <p>El envío a domicilio estará disponible próximamente.</p>
      </fieldset>

      <fieldset>
        <legend>Pago</legend>
        <label>
          <input type="radio" checked={modalidadCierre === "ONLINE"} onChange={() => setModalidadCierre("ONLINE")} /> Pago online
          (simulado: no se cobra dinero real). Tenés 30 minutos para completarlo.
        </label>
        <label>
          <input
            type="radio"
            checked={modalidadCierre === "EFECTIVO"}
            onChange={() => setModalidadCierre("EFECTIVO")}
            disabled={!hasPhone}
          />{" "}
          Reserva para pagar en efectivo en el local, dentro de las 24 horas.
        </label>
        {!hasPhone && <p>Para reservar con pago en efectivo necesitamos tu teléfono.</p>}
      </fieldset>

      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={confirm} disabled={pending}>
        Confirmar pedido
      </button>
    </>
  );
}
