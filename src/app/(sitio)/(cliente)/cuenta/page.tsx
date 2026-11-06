import { ChevronRight, ClipboardList, MessageSquare, TicketPercent } from "lucide-react";
import Link from "next/link";
import { requirePageUser } from "@/app/session";
import { StatusBadge } from "@/app/ui/status-badge";
import { unreadForClient } from "@/server/modules/chat/chat.service";
import { listAddresses } from "@/server/modules/users/profile.service";
import { AccountActions } from "./account-actions";
import styles from "./account.module.css";
import { AddressesManager, ProfileForm } from "./profile-forms";

export const dynamic = "force-dynamic";

/** Mi cuenta (Documento Maestro, 5.6): datos editables en el lugar, direcciones y accesos a pedidos, cupones y mensajes. */
export default async function AccountPage() {
  const user = await requirePageUser();
  const [addresses, unread] = await Promise.all([listAddresses(user.id), user.rol === "CLIENTE" ? unreadForClient(user.id) : 0]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Mi cuenta</h1>
        <p className={styles.email}>
          {user.email}
          <StatusBadge family={user.emailVerificado ? "done" : "wait"}>
            {user.emailVerificado ? "Email confirmado" : "Email sin confirmar"}
          </StatusBadge>
        </p>
      </header>

      <nav aria-label="Mi actividad" className={styles.shortcuts}>
        <Link href="/pedidos" className={styles.shortcut}>
          <ClipboardList aria-hidden="true" size={24} />
          <span>Mis pedidos</span>
          <ChevronRight aria-hidden="true" size={20} className={styles.chevron} />
        </Link>
        <Link href="/cupones" className={styles.shortcut}>
          <TicketPercent aria-hidden="true" size={24} />
          <span>Mis cupones</span>
          <ChevronRight aria-hidden="true" size={20} className={styles.chevron} />
        </Link>
        <Link href="/mensajes" className={styles.shortcut}>
          <MessageSquare aria-hidden="true" size={24} />
          <span>Mensajes</span>
          {unread > 0 && <StatusBadge family="wait">{unread === 1 ? "1 sin leer" : `${unread} sin leer`}</StatusBadge>}
          <ChevronRight aria-hidden="true" size={20} className={styles.chevron} />
        </Link>
      </nav>

      <section className={styles.card} aria-labelledby="datos-personales">
        <h2 id="datos-personales">Datos personales</h2>
        <ProfileForm nombre={user.nombre} telefono={user.telefono} />
      </section>

      <section className={styles.card} aria-labelledby="direcciones">
        <h2 id="direcciones">Direcciones de envío</h2>
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
      </section>

      <section className={styles.card} aria-labelledby="sesion">
        <h2 id="sesion">Sesión</h2>
        <AccountActions emailVerificado={user.emailVerificado} />
      </section>
    </main>
  );
}
