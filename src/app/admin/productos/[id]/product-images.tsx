"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { postJson, sendJson } from "@/lib/api";

type Image = { archivoId: string; nombre: string; url: string | null };

/** Imágenes del producto (RF-07): se suben con contexto PRODUCTO y después se asocian. */
export function ProductImages({ productId, images }: { productId: string; images: Image[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("contexto", "PRODUCTO");
    setPending(true);
    const response = await fetch("/api/files", { method: "POST", body: data }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok) {
      setPending(false);
      return setError(body?.mensaje ?? "No pudimos conectarnos.");
    }
    const attached = await postJson(`/api/admin/products/${productId}/images`, { archivoId: body.archivo.id });
    setPending(false);
    setError(attached.ok ? null : attached.error.mensaje);
    if (attached.ok) {
      form.reset();
      router.refresh();
    }
  }

  async function remove(archivoId: string) {
    if (!window.confirm("¿Quitar esta imagen del producto?")) return;
    const result = await sendJson("DELETE", `/api/admin/products/${productId}/images/${archivoId}`);
    setError(result.ok ? null : result.error.mensaje);
    if (result.ok) router.refresh();
  }

  return (
    <section aria-label="Imágenes">
      <h2>Imágenes</h2>
      {images.length === 0 && <p>Sin imágenes.</p>}
      <ul>
        {images.map((image) => (
          <li key={image.archivoId}>
            {image.url && (
              // URL firmada de corta duración al almacenamiento privado (16.1).
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.url} alt="" width={96} height={96} />
            )}{" "}
            {image.nombre}{" "}
            <button type="button" onClick={() => remove(image.archivoId)}>
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={upload}>
        {error && <p role="alert">{error}</p>}
        <label>
          Agregar imagen (JPG, PNG o WEBP)
          <input name="archivo" type="file" accept="image/jpeg,image/png,image/webp" required />
        </label>
        <button type="submit" disabled={pending}>
          Subir
        </button>
      </form>
    </section>
  );
}
