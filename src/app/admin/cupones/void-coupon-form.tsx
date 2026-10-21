"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldErrors, postJson, type ApiError } from "@/lib/api";

export function VoidCouponForm({ couponId }: { couponId: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await postJson(`/api/admin/coupons/${couponId}/void`, { motivo: new FormData(event.currentTarget).get("motivo") });
    setError(result.ok ? null : result.error);
    if (result.ok) router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <p role="alert">{Object.values(fieldErrors(error)).join(" ") || error.mensaje}</p>}
      <label>
        Motivo
        <input name="motivo" required />
      </label>
      <button type="submit">Anular</button>
    </form>
  );
}
