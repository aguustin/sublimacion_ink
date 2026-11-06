"use client";

import { Check, Minus, Plus, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/lib/api";
import { addToGuestCart, notifyCartChanged } from "@/lib/guest-cart";
import { formatPesos } from "@/lib/money";
import styles from "./product.module.css";

export type PurchaseOption = {
  id: string;
  label: string;
  precioCentavos: number | null;
  /** Unidades disponibles; `null` en personalizables, que no se compran desde el carrito (D-18). */
  disponible: number | null;
};

/**
 * Compra de un producto estándar (rediseño v1.38): se elige la opción, la cantidad y hay un único
 * botón principal. Usa el mismo carrito que antes: el de la cuenta con sesión, el del navegador sin ella.
 */
export function PurchasePanel({ options, loggedIn }: { options: PurchaseOption[]; loggedIn: boolean }) {
  // Por defecto, la primera opción con stock: el botón principal queda listo para usar.
  const [selectedId, setSelectedId] = useState(() => (options.find((option) => (option.disponible ?? 0) > 0) ?? options[0])?.id);
  const [cantidad, setCantidad] = useState(1);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const selected = options.find((option) => option.id === selectedId);
  const available = selected?.disponible ?? 0;

  function choose(id: string) {
    setSelectedId(id);
    setCantidad(1);
    setMessage(null);
  }

  async function add() {
    if (!selected || available === 0) return;
    setPending(true);
    if (loggedIn) {
      const result = await postJson("/api/cart/items", { varianteId: selected.id, cantidad });
      setMessage(result.ok ? { ok: true, text: "Agregado al carrito." } : { ok: false, text: result.error.mensaje });
      if (result.ok) notifyCartChanged();
    } else {
      const added = addToGuestCart(selected.id, cantidad, available);
      setMessage(
        added > 0 ? { ok: true, text: "Agregado al carrito." } : { ok: false, text: "Ya tenés en el carrito todas las unidades disponibles." },
      );
    }
    setPending(false);
  }

  return (
    <div className={styles.purchase}>
      <p className={styles.price}>{selected?.precioCentavos != null ? formatPesos(selected.precioCentavos) : "Consultá el precio"}</p>

      {options.length > 1 && (
        <fieldset className={styles.options}>
          <legend className={styles.optionsLegend}>Elegí una opción</legend>
          <div className={styles.optionList}>
            {options.map((option) => {
              const soldOut = option.disponible === 0;
              return (
                <label
                  key={option.id}
                  className={styles.option}
                  data-selected={option.id === selectedId || undefined}
                  data-sold-out={soldOut || undefined}
                >
                  <input type="radio" name="opcion" value={option.id} checked={option.id === selectedId} onChange={() => choose(option.id)} />
                  <span className={styles.optionName}>{option.label}</span>
                  <span className={styles.optionMeta}>
                    {option.precioCentavos === null ? "Consultá" : formatPesos(option.precioCentavos)}
                    {soldOut && " · Sin stock"}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {options.length === 1 && selected && selected.label !== "Única" && (
        <p className={styles.singleOption}>
          Opción: <strong>{selected.label}</strong>
        </p>
      )}

      <p className={styles.stock} data-sold-out={available === 0 || undefined}>
        {available === 0 ? "Sin stock por ahora" : available <= 3 ? `Quedan ${available} disponibles` : "Disponible"}
      </p>

      {available > 0 && (
        <div className={styles.buyRow}>
          <div className={styles.stepper} role="group" aria-label="Cantidad">
            <button type="button" onClick={() => setCantidad((value) => Math.max(1, value - 1))} disabled={cantidad <= 1} aria-label="Restar uno">
              <Minus aria-hidden="true" size={16} />
            </button>
            <input
              type="number"
              min={1}
              max={available}
              value={cantidad}
              onChange={(event) => setCantidad(Math.max(1, Math.min(available, Number(event.target.value) || 1)))}
              aria-label="Cantidad"
            />
            <button
              type="button"
              onClick={() => setCantidad((value) => Math.min(available, value + 1))}
              disabled={cantidad >= available}
              aria-label="Sumar uno"
            >
              <Plus aria-hidden="true" size={16} />
            </button>
          </div>
          <button type="button" className={`ink-btn-primary ${styles.addButton}`} onClick={add} disabled={pending}>
            <ShoppingCart aria-hidden="true" size={18} />
            {pending ? "Agregando…" : "Agregar al carrito"}
          </button>
        </div>
      )}

      {message && (
        <p role="status" className={message.ok ? styles.added : styles.addError}>
          {message.ok && <Check aria-hidden="true" size={18} />}
          {message.text}
          {message.ok && <Link href="/carrito">Ver carrito</Link>}
        </p>
      )}
    </div>
  );
}
