"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError, type ApiResult } from "@/lib/api";
import { formatPesos } from "@/lib/money";

type Product = {
  id: string;
  nombre: string;
  descripcion: string;
  categoriaId: string;
  tipo: "ESTANDAR" | "PERSONALIZABLE";
  activo: boolean;
};

type Variant = {
  id: string;
  sku: string;
  material: string | null;
  medida: string | null;
  color: string | null;
  talle: string | null;
  precioCentavos: number | null;
  activa: boolean;
  stockFisico: number;
  stockReservado: number;
};

const ATTRIBUTES = ["material", "medida", "color", "talle"] as const;

/** Precio en pesos del formulario (input numérico) a centavos; vacío = sin precio. */
function centsFrom(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : Math.round(Number(text) * 100);
}

function variantFromForm(form: FormData, standard: boolean) {
  return {
    ...Object.fromEntries(ATTRIBUTES.map((attribute) => [attribute, String(form.get(attribute) ?? "").trim() || null])),
    ...(standard && { precioCentavos: centsFrom(form.get("precio")) }),
  };
}

export function ProductEditor({
  product,
  variants,
  categories,
}: {
  product: Product;
  variants: Variant[];
  categories: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const standard = product.tipo === "ESTANDAR";

  async function run(request: Promise<ApiResult<unknown>>, success: string): Promise<boolean> {
    const result = await request;
    setError(result.ok ? null : result.error);
    setMessage(result.ok ? success : null);
    if (result.ok) router.refresh();
    return result.ok;
  }

  function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      sendJson("PATCH", `/api/admin/products/${product.id}`, {
        nombre: form.get("nombre"),
        descripcion: form.get("descripcion"),
        categoriaId: form.get("categoriaId"),
      }),
      "Producto guardado.",
    );
  }

  async function addVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const body = { sku: String(form.get("sku") ?? "").trim() || undefined, ...variantFromForm(form, standard) };
    if (await run(sendJson("POST", `/api/admin/products/${product.id}/variants`, body), "Variante agregada.")) element.reset();
  }

  function saveVariant(event: FormEvent<HTMLFormElement>, variant: Variant) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      sendJson("PATCH", `/api/admin/variants/${variant.id}`, { sku: form.get("sku"), ...variantFromForm(form, standard) }),
      "Variante guardada.",
    );
  }

  const errors = fieldErrors(error);
  return (
    <>
      {error && <p role="alert">{Object.keys(errors).length > 0 ? Object.values(errors).join(" ") : error.mensaje}</p>}
      {message && <p role="status">{message}</p>}

      <h2>Datos del producto</h2>
      <form onSubmit={saveProduct}>
        <label>
          Nombre
          <input name="nombre" defaultValue={product.nombre} required />
        </label>
        <label>
          Descripción
          <textarea name="descripcion" rows={4} defaultValue={product.descripcion} />
        </label>
        <label>
          Categoría
          <select name="categoriaId" defaultValue={product.categoriaId}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.nombre}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Guardar</button>{" "}
        <button
          type="button"
          onClick={() =>
            run(
              sendJson("PATCH", `/api/admin/products/${product.id}`, { activo: !product.activo }),
              product.activo ? "Producto desactivado." : "Producto activado.",
            )
          }
        >
          {product.activo ? "Desactivar" : "Activar"}
        </button>
      </form>

      <h2>Variantes</h2>
      {variants.length === 0 && <p>El producto no aparece en la tienda hasta que tenga una variante activa.</p>}
      {variants.map((variant) => (
        <form key={variant.id} onSubmit={(event) => saveVariant(event, variant)}>
          <fieldset>
            <legend>
              {variant.sku} · {variant.activa ? "Activa" : "Inactiva"}
              {variant.precioCentavos !== null && ` · ${formatPesos(variant.precioCentavos)}`} · Disponible:{" "}
              {variant.stockFisico - variant.stockReservado} (<a href={`/admin/inventario/variantes/${variant.id}`}>stock</a>)
            </legend>
            <label>
              SKU
              <input name="sku" defaultValue={variant.sku} required />
            </label>
            {ATTRIBUTES.map((attribute) => (
              <label key={attribute}>
                {attribute[0]?.toUpperCase() + attribute.slice(1)}
                <input name={attribute} defaultValue={variant[attribute] ?? ""} />
              </label>
            ))}
            {standard && (
              <label>
                Precio final ($, impuestos incluidos)
                <input
                  name="precio"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  defaultValue={variant.precioCentavos === null ? "" : variant.precioCentavos / 100}
                />
              </label>
            )}
            <button type="submit">Guardar</button>{" "}
            <button
              type="button"
              onClick={() =>
                run(
                  sendJson("PATCH", `/api/admin/variants/${variant.id}`, { activa: !variant.activa }),
                  variant.activa ? "Variante desactivada." : "Variante activada.",
                )
              }
            >
              {variant.activa ? "Desactivar" : "Activar"}
            </button>
          </fieldset>
        </form>
      ))}

      <h3>Agregar variante</h3>
      <form onSubmit={addVariant}>
        <label>
          SKU (opcional, se genera si queda vacío)
          <input name="sku" />
        </label>
        {ATTRIBUTES.map((attribute) => (
          <label key={attribute}>
            {attribute[0]?.toUpperCase() + attribute.slice(1)}
            <input name={attribute} />
          </label>
        ))}
        {standard ? (
          <label>
            Precio final ($, impuestos incluidos)
            <input name="precio" type="number" min="0.01" step="0.01" required />
          </label>
        ) : (
          <p>Los productos personalizables no llevan precio: la tienda muestra «Consultá el precio».</p>
        )}
        <button type="submit">Agregar</button>
      </form>
    </>
  );
}
