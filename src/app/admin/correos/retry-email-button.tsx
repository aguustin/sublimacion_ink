"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/api";

export function RetryEmailButton({ emailId }: { emailId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    const result = await postJson(`/api/admin/notifications/${emailId}/retry`);
    setError(result.ok ? null : result.error.mensaje);
    if (result.ok) router.refresh();
  }

  return (
    <>
      <button type="button" onClick={retry}>
        Reintentar
      </button>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
