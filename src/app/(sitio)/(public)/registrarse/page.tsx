"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { safeNextPath } from "@/lib/guest-cart";
import { RegisterForm } from "./register-form";

function RegisterPageContent() {
  const router = useRouter();
  const next = useSearchParams().get("next");

  return (
    <>
      <RegisterForm
        onRegistered={(outcome) => {
          router.push(outcome.adjusted ? "/carrito?aviso=ajustado" : safeNextPath(next, outcome.hadItems ? "/carrito" : "/cuenta"));
          router.refresh();
        }}
      />
      <p>
        ¿Ya tenés cuenta? <Link href={next ? `/ingresar?next=${encodeURIComponent(next)}` : "/ingresar"}>Ingresá</Link>
      </p>
    </>
  );
}

export default function RegisterPage() {
  return (
    <main>
      <h1>Crear una cuenta</h1>
      <Suspense>
        <RegisterPageContent />
      </Suspense>
    </main>
  );
}
