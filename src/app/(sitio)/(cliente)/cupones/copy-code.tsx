"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import styles from "./coupons.module.css";

/** Copia el código del cupón para pegarlo al finalizar la compra. */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso para el portapapeles: el código queda a la vista para copiarlo a mano.
    }
  }

  return (
    <button type="button" className={styles.copy} onClick={copy} aria-label={copied ? "Código copiado" : `Copiar el código ${code}`}>
      {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}
