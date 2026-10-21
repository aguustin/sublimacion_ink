import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/app/session";
import { getProductBySlug } from "@/server/modules/catalog/catalog.service";
import { listAddresses } from "@/server/modules/users/profile.service";
import { AppError } from "@/server/shared/errors";
import { CustomRequestForm } from "./custom-request-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pedir una cotización · Sublimaciones", robots: { index: false } };

/** Solicitud de personalización (RF-22): producto base, opción, cantidad, descripción, fecha y referencias. */
export default async function NewCustomRequestPage({ searchParams }: { searchParams: Promise<{ producto?: string }> }) {
  const user = await requirePageUser();
  const slug = (await searchParams).producto;
  const product = slug
    ? await getProductBySlug(slug).catch((error: unknown) => {
        if (error instanceof AppError && error.status === 404) notFound();
        throw error;
      })
    : notFound();
  if (product.tipo !== "PERSONALIZABLE") notFound();
  const addresses = await listAddresses(user.id);

  return (
    <main>
      <h1>Cotización: {product.nombre}</h1>
      <p>
        Contanos qué querés. La tienda te envía la cotización; recién cuando la aceptes empieza el plazo para pagar la seña.{" "}
        <Link href={`/productos/${product.slug}`}>Volver al producto</Link>
      </p>
      <CustomRequestForm
        variants={product.variantes.map((variant) => ({
          id: variant.id,
          label: [variant.material, variant.medida, variant.color, variant.talle].filter(Boolean).join(" · ") || "Única",
        }))}
        addresses={addresses.map((address) => ({ id: address.id, label: `${address.calle}, ${address.ciudad} (${address.codigoPostal})` }))}
      />
    </main>
  );
}
