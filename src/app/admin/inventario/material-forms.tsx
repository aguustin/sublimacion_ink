"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";

const threshold = (value: FormDataEntryValue | null) => (String(value ?? "").trim() === "" ? null : Number(value));

function ErrorMessage({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const errors = Object.values(fieldErrors(error));
  return <p role="alert">{errors.length > 0 ? errors.join(" ") : error.mensaje}</p>;
}

export function MaterialCreateForm() {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const result = await sendJson("POST", "/api/admin/materials", {
      nombre: form.get("nombre"),
      unidad: form.get("unidad"),
      umbralStockBajo: threshold(form.get("umbral")),
    });
    setError(result.ok ? null : result.error);
    if (result.ok) {
      element.reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <ErrorMessage error={error} />
      <label>
        Nombre
        <input name="nombre" required />
      </label>
      <label>
        Unidad (cantidades enteras: elegí una unidad chica, por ejemplo cm² o ml)
        <input name="unidad" required />
      </label>
      <label>
        Alerta de stock bajo (opcional)
        <input name="umbral" type="number" min="0" step="1" />
      </label>
      <button type="submit">Crear</button>
    </form>
  );
}

export function MaterialEditForm({
  material,
}: {
  material: { id: string; nombre: string; unidad: string; umbralStockBajo: number | null; activo: boolean };
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function save(body: unknown) {
    const result = await sendJson("PATCH", `/api/admin/materials/${material.id}`, body);
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save({ nombre: form.get("nombre"), unidad: form.get("unidad"), umbralStockBajo: threshold(form.get("umbral")) });
  }

  return (
    <form onSubmit={onSubmit}>
      <ErrorMessage error={error} />
      <label>
        Nombre
        <input name="nombre" defaultValue={material.nombre} required />
      </label>
      <label>
        Unidad
        <input name="unidad" defaultValue={material.unidad} required />
      </label>
      <label>
        Alerta de stock bajo
        <input name="umbral" type="number" min="0" step="1" defaultValue={material.umbralStockBajo ?? ""} />
      </label>
      <button type="submit">Guardar</button>{" "}
      <button type="button" onClick={() => save({ activo: !material.activo })}>
        {material.activo ? "Desactivar" : "Activar"}
      </button>
    </form>
  );
}

export function VariantThresholdForm({ variantId, threshold: current }: { variantId: string; threshold: number | null }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await sendJson("PATCH", `/api/admin/variants/${variantId}`, {
      umbralStockBajo: threshold(new FormData(event.currentTarget).get("umbral")),
    });
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <ErrorMessage error={error} />
      <label>
        Alerta de stock bajo (vacío = sin alerta)
        <input name="umbral" type="number" min="0" step="1" defaultValue={current ?? ""} />
      </label>
      <button type="submit">Guardar</button>
    </form>
  );
}

/** Ingreso o ajuste de stock físico (RF-08). */
export function StockMovementForm({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [tipo, setTipo] = useState<"INGRESO" | "AJUSTE">("INGRESO");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const result = await sendJson("POST", endpoint, { tipo, cantidad: Number(form.get("cantidad")), motivo: form.get("motivo") });
    setError(result.ok ? null : result.error);
    if (result.ok) {
      element.reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <ErrorMessage error={error} />
      <fieldset>
        <legend>Movimiento</legend>
        <label>
          <input type="radio" checked={tipo === "INGRESO"} onChange={() => setTipo("INGRESO")} /> Ingreso (suma unidades)
        </label>
        <label>
          <input type="radio" checked={tipo === "AJUSTE"} onChange={() => setTipo("AJUSTE")} /> Ajuste (corrige el físico, con signo)
        </label>
      </fieldset>
      <label>
        {tipo === "INGRESO" ? "Unidades que ingresan" : "Diferencia (por ejemplo −2 o 3)"}
        <input name="cantidad" type="number" step="1" min={tipo === "INGRESO" ? 1 : undefined} required />
      </label>
      <label>
        Motivo {tipo === "AJUSTE" ? "(obligatorio)" : "(opcional)"}
        <input name="motivo" required={tipo === "AJUSTE"} />
      </label>
      <button type="submit">Registrar</button>
    </form>
  );
}
