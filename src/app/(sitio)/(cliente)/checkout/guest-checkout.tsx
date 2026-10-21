"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RegisterForm } from "@/app/(sitio)/(public)/registrarse/register-form";

/**
 * Visitante en el checkout (RN-25): crea la cuenta en el mismo paso, sin perder el carrito
 * del navegador, y sigue con la compra.
 */
export function GuestCheckout() {
  const router = useRouter();

  return (
    <>
      <p>Para confirmar el pedido, creá tu cuenta. Tu carrito se conserva.</p>
      <RegisterForm
        phoneHint="(necesario para reservar con pago en efectivo)"
        onRegistered={(outcome) => {
          if (outcome.adjusted) router.push("/carrito?aviso=ajustado");
          router.refresh();
        }}
      />
      <p>
        ¿Ya tenés cuenta? <Link href="/ingresar?next=/checkout">Ingresá</Link>
      </p>
    </>
  );
}
