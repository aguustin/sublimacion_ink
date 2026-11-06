import { MapPin, UserRound } from "lucide-react";
import { requirePageUser } from "@/app/session";
import { StatusBadge } from "@/app/ui/status-badge";
import { listAddresses } from "@/server/modules/users/profile.service";
import { AccountNav } from "../account-nav";
import { LogoutButton, ResendVerification } from "./account-actions";
import styles from "./account.module.css";
import { AddressesManager, ProfileForm } from "./profile-forms";

export const dynamic = "force-dynamic";

/** Iniciales para el avatar: primera letra de las dos primeras palabras del nombre. */
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** Mi cuenta (rediseño según diseno.txt): perfil arriba, datos y direcciones en tarjetas editables en el lugar. */
export default async function AccountPage() {
  const user = await requirePageUser();
  const addresses = await listAddresses(user.id);

  return (
    <main className={styles.page}>
      <AccountNav />
      <header className={styles.profile}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(user.nombre)}
        </span>
        <div className={styles.profileText}>
          <span className="ink-eyebrow">Mi cuenta</span>
          <h1>{user.nombre}</h1>
          <p className={styles.email}>
            {user.email}
            <StatusBadge family={user.emailVerificado ? "done" : "wait"}>
              {user.emailVerificado ? "Email confirmado" : "Email sin confirmar"}
            </StatusBadge>
          </p>
        </div>
        <LogoutButton />
      </header>

      {!user.emailVerificado && (
        <div className={styles.verify}>
          <div>
            <strong>Confirmá tu email</strong>
            <p>Te mandamos un enlace cuando creaste la cuenta. Si no lo encontrás, te lo enviamos de nuevo.</p>
          </div>
          <ResendVerification />
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="datos-personales">
          <div className={styles.cardHead}>
            <span className={styles.cardIcon} aria-hidden="true">
              <UserRound size={20} />
            </span>
            <h2 id="datos-personales">Datos personales</h2>
          </div>
          <ProfileForm nombre={user.nombre} telefono={user.telefono} />
        </section>

        <section className={styles.card} aria-labelledby="direcciones">
          <div className={styles.cardHead}>
            <span className={styles.cardIcon} aria-hidden="true">
              <MapPin size={20} />
            </span>
            <h2 id="direcciones">Direcciones de envío</h2>
          </div>
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
      </div>
    </main>
  );
}
