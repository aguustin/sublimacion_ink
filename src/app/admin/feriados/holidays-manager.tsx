"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";

type Holiday = { id: string; fecha: string; descripcion: string };

export function HolidaysManager({ holidays }: { holidays: Holiday[] }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const result = await sendJson<{ reservasExtendidas: number }>("POST", "/api/admin/holidays", {
      fecha: form.get("fecha"),
      descripcion: form.get("descripcion"),
    });
    setError(result.ok ? null : result.error);
    if (result.ok) {
      element.reset();
      setMessage(`Feriado agregado. Reservas extendidas: ${result.data.reservasExtendidas}.`);
      router.refresh();
    }
  }

  async function remove(holiday: Holiday) {
    if (!window.confirm(`¿Quitar el feriado del ${holiday.fecha}?`)) return;
    const result = await sendJson("DELETE", `/api/admin/holidays/${holiday.id}`);
    setError(result.ok ? null : result.error);
    setMessage(result.ok ? "Feriado quitado." : null);
    if (result.ok) router.refresh();
  }

  const errors = fieldErrors(error);
  return (
    <>
      {error && <p role="alert">{Object.values(errors).join(" ") || error.mensaje}</p>}
      {message && <p role="status">{message}</p>}
      {holidays.length === 0 ? (
        <p>No hay feriados cargados para este año.</p>
      ) : (
        <ul>
          {holidays.map((holiday) => (
            <li key={holiday.id}>
              {holiday.fecha} · {holiday.descripcion}{" "}
              <button type="button" onClick={() => remove(holiday)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate>
        <label>
          Fecha
          <input name="fecha" type="date" required />
        </label>
        <label>
          Descripción
          <input name="descripcion" required placeholder="Por ejemplo: Día de la Independencia" />
        </label>
        <button type="submit">Agregar feriado</button>
      </form>
    </>
  );
}
