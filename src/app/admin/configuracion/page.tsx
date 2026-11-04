import { requireAdminPage } from "@/app/session";
import { getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { StoreSettingsForm } from "./store-settings-form";
import { PageHeader } from "../page-header";

export const dynamic = "force-dynamic";

export default async function StoreSettingsPage() {
  await requireAdminPage();
  return (
    <main>
      <PageHeader
        title="Configuración de la tienda"
        description="Estos datos se muestran en la página de contacto y en los avisos a los clientes (por ejemplo, al reservar con pago en efectivo)."
      />
      <StoreSettingsForm settings={await getStoreContact()} />
    </main>
  );
}
