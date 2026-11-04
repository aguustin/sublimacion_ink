import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { ADMIN_SECTIONS } from "./admin-sections";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

// El panel inicial con indicadores es de INC-13 (RF-45): por ahora, accesos a las secciones.
export default async function AdminHomePage() {
  const admin = await requireAdminPage();
  return (
    <main>
      <h1>Hola, {admin.nombre}</h1>
      <p className={styles.lead}>¿Qué querés gestionar?</p>
      <ul className={styles.grid}>
        {ADMIN_SECTIONS.filter((section) => section.description).map(({ href, label, description, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className={styles.card}>
              <Icon aria-hidden="true" size={24} className={styles.icon} />
              <span className={styles.title}>{label}</span>
              <span className={styles.description}>{description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
