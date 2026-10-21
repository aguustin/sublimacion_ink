"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";

/** RF-25, RF-26: el cliente aprueba la versión vigente (con la huella que ve) o pide cambios. */
export function DesignReview({ versionId, numero, huella }: { versionId: string; numero: number; huella: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function run(path: string, body: unknown) {
    const result = await postJson(`/api/design-versions/${versionId}/${path}`, body);
    setError(result.ok ? null : result.error);
    router.refresh();
  }

  function requestChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("request-changes", { comentario: new FormData(event.currentTarget).get("comentario") });
  }

  return (
    <section aria-label="Revisar el diseño">
      {error && <p role="alert">{Object.values(fieldErrors(error)).join(" ") || error.mensaje}</p>}
      <p>Apruebo la versión {numero} para fabricación, con las medidas y materiales indicados.</p>
      <button type="button" onClick={() => run("approve", { huella })}>
        Aprobar la versión {numero}
      </button>
      <form onSubmit={requestChanges} noValidate>
        <label>
          Qué cambiar
          <textarea name="comentario" required />
        </label>
        <button type="submit">Pedir cambios</button>
      </form>
    </section>
  );
}
