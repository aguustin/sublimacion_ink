"use client";

import { useState } from "react";

/** Pide la URL firmada recién al hacer clic: dura pocos minutos y solo se genera si hay permiso (16.1). */
export function OpenFileButton({ fileId, name }: { fileId: string; name: string }) {
  const [error, setError] = useState<string | null>(null);

  async function open() {
    const response = await fetch(`/api/files/${fileId}/url`).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok) return setError(body?.mensaje ?? "No pudimos abrir el archivo.");
    window.open(body.url, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <button type="button" onClick={open}>
        {name}
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
