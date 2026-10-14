import Link from "next/link";
import { requirePageUser } from "@/app/session";
import { AccountActions } from "./account-actions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requirePageUser();

  return (
    <main>
      <h1>Mi cuenta</h1>
      <p>
        {user.nombre} · {user.email}
      </p>
      {user.telefono && <p>Teléfono: {user.telefono}</p>}
      <p>{user.emailVerificado ? "Tu email está confirmado." : "Todavía no confirmaste tu email."}</p>
      <p>
        <Link href="/pedidos">Mis pedidos</Link>
      </p>
      <AccountActions emailVerificado={user.emailVerificado} />
    </main>
  );
}
