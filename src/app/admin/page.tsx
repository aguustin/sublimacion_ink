import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { ORDER_STATUS_LABELS } from "@/lib/orders";
import { getAdminDashboard } from "@/server/modules/admin/dashboard.service";
import { ADMIN_SECTIONS } from "./admin-sections";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

/** Panel inicial (RF-45): lo que requiere atención y, debajo, los accesos a las secciones. */
export default async function AdminHomePage() {
  const admin = await requireAdminPage();
  const dashboard = await getAdminDashboard();
  const indicators = [
    { href: "/admin/pedidos?estado=RESERVADO", value: dashboard.reservasPorVencer, label: "Reservas que vencen en 24 h" },
    { href: "/admin/pedidos", value: dashboard.disenosPendientes, label: "Diseños esperando la aprobación del cliente" },
    { href: "/admin/mensajes", value: dashboard.mensajesSinLeer, label: "Mensajes sin leer" },
    { href: "/admin/inventario?bajo=1", value: dashboard.stockBajo, label: "Variantes y materiales con stock bajo" },
    { href: "/admin/pedidos", value: dashboard.cargosPendientes, label: "Cargos pendientes de arreglo" },
    { href: "/admin/pedidos", value: dashboard.devolucionesPendientes, label: "Devoluciones pendientes" },
  ];

  return (
    <main>
      <h1>Hola, {admin.nombre}</h1>

      <section aria-labelledby="atencion" className={styles.panel}>
        <h2 id="atencion">Para atender</h2>
        <ul className={styles.indicators}>
          {indicators.map(({ href, value, label }) => (
            <li key={label}>
              <Link href={href} className={value > 0 ? `${styles.indicator} ${styles.pending}` : styles.indicator}>
                <span className={styles.value}>{value}</span>
                <span className={styles.description}>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <h3>Pedidos abiertos por estado</h3>
        {dashboard.pedidosPorEstado.length === 0 ? (
          <p className={styles.lead}>No hay pedidos abiertos.</p>
        ) : (
          <ul className={styles.states}>
            {dashboard.pedidosPorEstado.map(({ estado, cantidad }) => (
              <li key={estado}>
                <Link href={`/admin/pedidos?estado=${estado}`} className="ink-btn">
                  {ORDER_STATUS_LABELS[estado] ?? estado}: {cantidad}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2>Secciones</h2>
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
