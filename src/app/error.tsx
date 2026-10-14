"use client";

// Nunca se muestran detalles técnicos al usuario (RNF-12); el error queda en los logs del servidor.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <h1>Algo salió mal</h1>
      <p>Ocurrió un error inesperado. Intentá de nuevo más tarde.</p>
      <button type="button" onClick={reset}>
        Reintentar
      </button>
    </main>
  );
}
