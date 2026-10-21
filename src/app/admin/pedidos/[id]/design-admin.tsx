"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";

/** RF-24: sube los archivos (contexto VERSION_DISENO, 16.1) y crea con ellos una versión nueva e inmutable. */
export function DesignVersionForm({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    try {
      const archivoIds: string[] = [];
      for (const file of data.getAll("archivos")) {
        if (!(file instanceof File) || file.size === 0) continue;
        const upload = new FormData();
        upload.set("archivo", file);
        upload.set("contexto", "VERSION_DISENO");
        const response = await fetch("/api/files", { method: "POST", body: upload }).catch(() => null);
        const body = await response?.json().catch(() => null);
        if (!response?.ok) throw body ?? { codigo: "SIN_CONEXION", mensaje: "No pudimos conectarnos." };
        archivoIds.push(body.archivo.id);
      }
      const result = await postJson(`/api/admin/order-items/${itemId}/design-versions`, { archivoIds, nota: data.get("nota") || undefined });
      if (!result.ok) throw result.error;
      setError(null);
      form.reset();
      router.refresh();
    } catch (failure) {
      setError(failure as ApiError);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <p role="alert">{Object.values(fieldErrors(error)).join(" ") || error.mensaje}</p>}
      <label>
        Archivos de la versión (JPG, PNG, WEBP o PDF)
        <input name="archivos" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" required />
      </label>
      <label>
        Nota para el cliente (opcional)
        <input name="nota" />
      </label>
      <button type="submit" disabled={pending}>
        Cargar la versión nueva
      </button>
    </form>
  );
}

/** RF-27: pasa el pedido a producción; el servidor exige los diseños vigentes aprobados (RN-07). */
export function StartProductionButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const result = await postJson(`/api/admin/orders/${orderId}/transitions`, { estado: "EN_PRODUCCION" });
    setError(result.ok ? null : result.error.mensaje);
    if (result.ok) router.refresh();
  }

  return (
    <>
      <button type="button" onClick={start}>
        Pasar a producción
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
