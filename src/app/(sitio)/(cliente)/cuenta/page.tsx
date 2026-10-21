import Link from "next/link";
import { requirePageUser } from "@/app/session";
import { listAddresses } from "@/server/modules/users/profile.service";
import { AccountActions } from "./account-actions";
import { AddressesManager, ProfileForm } from "./profile-forms";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requirePageUser();
  const addresses = await listAddresses(user.id);

  return (
    <main>
      <h1>Mi cuenta</h1>
      <p>{user.email}</p>
      <p>{user.emailVerificado ? "Tu email está confirmado." : "Todavía no confirmaste tu email."}</p>
      <p>
        <Link href="/pedidos">Mis pedidos</Link> · <Link href="/cupones">Mis cupones</Link>
      </p>

      <h2>Datos personales</h2>
      <ProfileForm nombre={user.nombre} telefono={user.telefono} />

      <h2>Direcciones de envío</h2>
      <AddressesManager
        addresses={addresses.map(({ id, calle, ciudad, provincia, codigoPostal, referencias }) => ({
          id,
          calle,
          ciudad,
          provincia,
          codigoPostal,
          referencias,
        }))}
      />

      <AccountActions emailVerificado={user.emailVerificado} />
    </main>
  );
}
