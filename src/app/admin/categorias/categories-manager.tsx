"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson, type ApiError, type ApiResult } from "@/lib/api";

type Category = { id: string; nombre: string; slug: string; activa: boolean; productos: number };

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function run(request: Promise<ApiResult<unknown>>): Promise<boolean> {
    const result = await request;
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
    return result.ok;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await run(sendJson("POST", "/api/admin/categories", { nombre: new FormData(form).get("nombre") }))) form.reset();
  }

  function rename(category: Category) {
    const nombre = window.prompt("Nuevo nombre", category.nombre);
    if (nombre) void run(sendJson("PATCH", `/api/admin/categories/${category.id}`, { nombre }));
  }

  return (
    <>
      {error && <p role="alert">{error.mensaje}</p>}
      <form onSubmit={create}>
        <label>
          Nueva categoría
          <input name="nombre" required />
        </label>
        <button type="submit">Crear</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>URL</th>
            <th>Productos</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category.id}>
              <td>{category.nombre}</td>
              <td>{category.slug}</td>
              <td>{category.productos}</td>
              <td>{category.activa ? "Activa" : "Inactiva"}</td>
              <td>
                <button type="button" onClick={() => rename(category)}>
                  Renombrar
                </button>{" "}
                <button
                  type="button"
                  onClick={() => run(sendJson("PATCH", `/api/admin/categories/${category.id}`, { activa: !category.activa }))}
                >
                  {category.activa ? "Desactivar" : "Activar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
