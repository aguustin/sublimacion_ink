"use client";

import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";
import styles from "./account.module.css";

/** Error general: solo cuando no hay errores de campo, que se muestran junto a cada campo (5.6). */
function GeneralError({ error }: { error: ApiError | null }) {
  if (!error || Object.keys(fieldErrors(error)).length > 0) return null;
  return <p role="alert">{error.mensaje}</p>;
}

/** Campo con su mensaje de validación debajo, asociado al control. */
function Field({ label, error, ...input }: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const errorId = useId();
  return (
    <label>
      {label}
      <input {...input} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
      {error && (
        <span id={errorId} className={styles.fieldError}>
          {error}
        </span>
      )}
    </label>
  );
}

/** Datos personales: se ven como datos y se editan en el lugar, con guardar y cancelar (Documento Maestro, 5.6). */
export function ProfileForm({ nombre, telefono }: { nombre: string; telefono: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const result = await sendJson("PATCH", "/api/account/profile", { nombre: form.get("nombre"), telefono: form.get("telefono") });
    setPending(false);
    setError(result.ok ? null : result.error);
    setSaved(result.ok);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <>
        <dl className={styles.data}>
          <dt>Nombre</dt>
          <dd>{nombre}</dd>
          <dt>Teléfono</dt>
          <dd>{telefono ?? <span className={styles.muted}>Sin cargar (lo necesitás para reservar con pago en efectivo)</span>}</dd>
        </dl>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setSaved(false);
            }}
          >
            <Pencil aria-hidden="true" size={16} />
            Editar
          </button>
          {saved && <span role="status">Guardado.</span>}
        </div>
      </>
    );
  }

  const errors = fieldErrors(error);
  return (
    <form onSubmit={onSubmit} noValidate>
      <GeneralError error={error} />
      <Field label="Nombre" name="nombre" defaultValue={nombre} autoComplete="name" required error={errors.nombre} />
      <Field
        label="Teléfono (necesario para reservar con pago en efectivo)"
        name="telefono"
        type="tel"
        defaultValue={telefono ?? ""}
        autoComplete="tel"
        error={errors.telefono}
      />
      <div className={styles.actions}>
        <button type="submit" disabled={pending}>
          Guardar
        </button>
        <button type="button" onClick={cancel}>
          Cancelar
        </button>
      </div>
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
  // Qué formulario está abierto: el id de una dirección, "nueva" o ninguno. Uno solo a la vez.
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [listError, setListError] = useState<ApiError | null>(null);

  function open(target: string | null) {
    setEditing(target);
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>, address?: Address) {
    event.preventDefault();
    const body = addressBody(new FormData(event.currentTarget));
    const result = address
      ? await sendJson("PATCH", `/api/account/addresses/${address.id}`, body)
      : await sendJson("POST", "/api/account/addresses", body);
    setError(result.ok ? null : result.error);
    if (result.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  async function remove(address: Address) {
    if (!window.confirm("¿Borrar esta dirección?")) return;
    const result = await sendJson("DELETE", `/api/account/addresses/${address.id}`);
    setListError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  const form = (address?: Address) => {
    const errors = fieldErrors(error);
    return (
      <form onSubmit={(event) => save(event, address)} noValidate>
        <GeneralError error={error} />
        {FIELDS.map(([name, label]) => (
          <Field key={name} label={label} name={name} defaultValue={address?.[name] ?? ""} required={name !== "referencias"} error={errors[name]} />
        ))}
        <div className={styles.actions}>
          <button type="submit">{address ? "Guardar" : "Agregar dirección"}</button>
          <button type="button" onClick={() => open(null)}>
            Cancelar
          </button>
        </div>
      </form>
    );
  };

  return (
    <>
      <GeneralError error={listError} />
      {addresses.length === 0 && editing !== "nueva" && <p className={styles.muted}>No tenés direcciones guardadas.</p>}
      {addresses.length > 0 && (
        <ul className={styles.addresses}>
          {addresses.map((address) => (
            <li key={address.id} className={styles.address}>
              {editing === address.id ? (
                form(address)
              ) : (
                <>
                  <MapPin aria-hidden="true" size={20} className={styles.addressIcon} />
                  <span className={styles.addressText}>
                    <span>{address.calle}</span>
                    <span className={styles.muted}>
                      {address.ciudad}, {address.provincia} ({address.codigoPostal})
                    </span>
                    {address.referencias && <span className={styles.muted}>{address.referencias}</span>}
                  </span>
                  <span className={styles.addressActions}>
                    <button type="button" onClick={() => open(address.id)}>
                      <Pencil aria-hidden="true" size={16} />
                      Editar
                    </button>
                    <button type="button" className="ink-btn-danger" onClick={() => remove(address)}>
                      <Trash2 aria-hidden="true" size={16} />
                      Borrar
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === "nueva" ? (
        <div className={styles.newAddress}>
          <h3>Nueva dirección</h3>
          {form()}
        </div>
      ) : (
        <button type="button" onClick={() => open("nueva")}>
          <Plus aria-hidden="true" size={18} />
          Agregar dirección
        </button>
      )}
    </>
  );
}
