import { requireAdminPage } from "@/app/session";
import { getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { StoreSettingsForm } from "./store-settings-form";

export const dynamic = "force-dynamic";

export default async function StoreSettingsPage() {
  await requireAdminPage();
  return (
    <main>
      <h1>Configuración de la tienda</h1>
      <p>Estos datos se muestran en la página de contacto y en los avisos a los clientes (por ejemplo, al reservar con pago en efectivo).</p>
      <StoreSettingsForm settings={await getStoreContact()} />
    </main>
  );
}
