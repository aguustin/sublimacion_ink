"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";

function Errors({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const errors = Object.values(fieldErrors(error));
  return <p role="alert">{errors.length > 0 ? errors.join(" ") : error.mensaje}</p>;
}

export function ProfileForm({ nombre, telefono }: { nombre: string; telefono: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await sendJson("PATCH", "/api/account/profile", { nombre: form.get("nombre"), telefono: form.get("telefono") });
    setError(result.ok ? null : result.error);
    setSaved(result.ok);
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Errors error={error} />
      <label>
        Nombre
        <input name="nombre" defaultValue={nombre} autoComplete="name" required />
      </label>
      <label>
        Teléfono (necesario para reservar con pago en efectivo)
        <input name="telefono" type="tel" defaultValue={telefono ?? ""} autoComplete="tel" />
      </label>
      <button type="submit">Guardar</button>
      {saved && <span role="status"> Guardado.</span>}
    </form>
  );
}

type Address = {
  id: string;
  calle: string;
  ciudad: string;
  provincia: string;
  codigoPostal: string;
  referencias: string | null;
};

const FIELDS = [
  ["calle", "Calle y número"],
  ["ciudad", "Ciudad o localidad"],
  ["provincia", "Provincia"],
  ["codigoPostal", "Código postal"],
  ["referencias", "Referencias (opcional)"],
] as const;

const addressBody = (form: FormData) => Object.fromEntries(FIELDS.map(([name]) => [name, String(form.get(name) ?? "")]));

/** Direcciones de envío (RF-03). Se van a elegir en el checkout con envío. */
export function AddressesManager({ addresses }: { addresses: Address[] }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>, address?: Address) {
    event.preventDefault();
    const element = event.currentTarget;
    const result = address
      ? await sendJson("PATCH", `/api/account/addresses/${address.id}`, addressBody(new FormData(element)))
      : await sendJson("POST", "/api/account/addresses", addressBody(new FormData(element)));
    setError(result.ok ? null : result.error);
    if (result.ok) {
      if (!address) element.reset();
      setEditing(null);
      router.refresh();
    }
  }

  async function remove(address: Address) {
    if (!window.confirm("¿Borrar esta dirección?")) return;
    const result = await sendJson("DELETE", `/api/account/addresses/${address.id}`);
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  const form = (address?: Address) => (
    <form onSubmit={(event) => save(event, address)} noValidate>
      {FIELDS.map(([name, label]) => (
        <label key={name}>
          {label}
          <input name={name} defaultValue={address?.[name] ?? ""} required={name !== "referencias"} />
        </label>
      ))}
      <button type="submit">{address ? "Guardar" : "Agregar dirección"}</button>
    </form>
  );

  return (
    <>
      <Errors error={error} />
      {addresses.length === 0 && <p>No tenés direcciones guardadas.</p>}
      <ul>
        {addresses.map((address) => (
          <li key={address.id}>
            {editing === address.id ? (
              form(address)
            ) : (
              <>
                {address.calle}, {address.ciudad}, {address.provincia} ({address.codigoPostal})
                {address.referencias && ` · ${address.referencias}`}{" "}
                <button type="button" onClick={() => setEditing(address.id)}>
                  Editar
                </button>{" "}
                <button type="button" onClick={() => remove(address)}>
                  Borrar
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <h3>Nueva dirección</h3>
      {form()}
    </>
  );
}
