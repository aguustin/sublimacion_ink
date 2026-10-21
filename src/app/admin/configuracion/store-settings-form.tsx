"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";

export function StoreSettingsForm({ settings }: { settings: { emailContacto: string | null; telefonoContacto: string | null } }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await sendJson("PUT", "/api/admin/store-settings", {
      emailContacto: form.get("emailContacto"),
      telefonoContacto: form.get("telefonoContacto"),
    });
    setError(result.ok ? null : result.error);
    setSaved(result.ok);
    if (result.ok) router.refresh();
  }

  const errors = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <p role="alert">{Object.values(errors).join(" ") || error.mensaje}</p>}
      <label>
        Email de contacto
        <input name="emailContacto" type="email" defaultValue={settings.emailContacto ?? ""} />
      </label>
      <label>
        Teléfono de contacto
        <input name="telefonoContacto" type="tel" defaultValue={settings.telefonoContacto ?? ""} />
      </label>
      <button type="submit">Guardar</button>
      {saved && <span role="status"> Guardado.</span>}
    </form>
  );
}
