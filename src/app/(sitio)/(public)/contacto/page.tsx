import type { Metadata } from "next";
import { getStoreContact } from "@/server/modules/store-settings/store-settings.service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Contacto · Sublimaciones", description: "Cómo comunicarte con la tienda." };

export default async function ContactPage() {
  const { emailContacto, telefonoContacto } = await getStoreContact();

  return (
    <main>
      <h1>Contacto</h1>
      {!emailContacto && !telefonoContacto ? (
        <p>Pronto vas a encontrar acá nuestros datos de contacto.</p>
      ) : (
        <ul>
          {emailContacto && (
            <li>
              Email: <a href={`mailto:${emailContacto}`}>{emailContacto}</a>
            </li>
          )}
          {telefonoContacto && (
            <li>
              Teléfono: <a href={`tel:${telefonoContacto.replace(/[\s-]/g, "")}`}>{telefonoContacto}</a>
            </li>
          )}
        </ul>
      )}
    </main>
  );
}
