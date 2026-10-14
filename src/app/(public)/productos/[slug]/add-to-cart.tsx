"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/lib/api";
import { addToGuestCart } from "@/lib/guest-cart";

export function AddToCart({ varianteId, disponible, loggedIn }: { varianteId: string; disponible: number; loggedIn: boolean }) {
  const [cantidad, setCantidad] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (disponible === 0) return null;

  async function add() {
    setPending(true);
    if (loggedIn) {
      const result = await postJson("/api/cart/items", { varianteId, cantidad });
      setMessage(result.ok ? "Agregado al carrito." : result.error.mensaje);
    } else {
      const added = addToGuestCart(varianteId, cantidad, disponible);
      setMessage(added > 0 ? "Agregado al carrito." : "Ya tenés en el carrito todas las unidades disponibles.");
    }
    setPending(false);
  }

  return (
    <span>
      <input
        type="number"
        min={1}
        max={disponible}
        value={cantidad}
        onChange={(event) => setCantidad(Math.max(1, Math.min(disponible, Number(event.target.value) || 1)))}
        aria-label="Cantidad"
      />{" "}
      <button type="button" onClick={add} disabled={pending}>
        Agregar al carrito
      </button>
      {message && (
        <span role="status">
          {" "}
          {message} <Link href="/carrito">Ver carrito</Link>
        </span>
      )}
    </span>
  );
}
