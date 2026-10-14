"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";

export function ProductCreateForm({ categories }: { categories: { id: string; nombre: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await sendJson<{ producto: { id: string } }>("POST", "/api/admin/products", {
      nombre: form.get("nombre"),
      descripcion: form.get("descripcion"),
      categoriaId: form.get("categoriaId"),
      tipo: form.get("tipo"),
    });
    if (!result.ok) return setError(result.error);
    router.push(`/admin/productos/${result.data.producto.id}`);
  }

  if (categories.length === 0) return <p>Primero creá una categoría.</p>;
  const errors = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} noValidate>
      <label>
        Nombre
        <input name="nombre" required />
      </label>
      {errors.nombre && <p role="alert">{errors.nombre}</p>}
      <label>
        Descripción
        <textarea name="descripcion" rows={4} />
      </label>
      <label>
        Categoría
        <select name="categoriaId" required>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.nombre}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Tipo (no se puede cambiar después)</legend>
        <label>
          <input type="radio" name="tipo" value="ESTANDAR" defaultChecked /> Estándar: cada variante tiene precio
        </label>
        <label>
          <input type="radio" name="tipo" value="PERSONALIZABLE" /> Personalizable: se muestra «Consultá el precio»
        </label>
      </fieldset>
      {error && Object.keys(errors).length === 0 && <p role="alert">{error.mensaje}</p>}
      <button type="submit">Crear y agregar variantes</button>
    </form>
  );
}
