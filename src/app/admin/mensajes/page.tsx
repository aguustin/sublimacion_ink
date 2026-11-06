import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { StatusBadge } from "@/app/ui/status-badge";
import { formatDateTime } from "@/lib/orders";
import { listConversations } from "@/server/modules/chat/chat.service";
import { PageHeader } from "../page-header";
import styles from "./messages.module.css";

export const dynamic = "force-dynamic";

/** Conversaciones con clientes (RF-29), la de actividad más reciente primero y con sus no leídos. */
export default async function AdminConversationsPage() {
  await requireAdminPage();
  const conversations = await listConversations();

  return (
    <main>
      <PageHeader title="Mensajes" href="/admin/mensajes" />
      {conversations.length === 0 ? (
        <p>Todavía no hay conversaciones. Podés escribirle a un cliente desde el detalle de su pedido.</p>
      ) : (
        <table className="ink-table-cards">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Último mensaje</th>
              <th>Fecha</th>
              <th>Sin leer</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map(({ cliente, ultimo, ultimoMensajeEn, sinLeer }) => (
              <tr key={cliente.id}>
                <td data-label="Cliente">
                  <Link href={`/admin/mensajes/${cliente.id}`}>{cliente.nombre}</Link>
                  <span className={styles.email}>{cliente.email}</span>
                </td>
                <td data-label="Último mensaje">
                  {ultimo &&
                    (ultimo.ocultoEn
                      ? "(mensaje oculto)"
                      : `${ultimo.deTienda ? "Vos: " : ""}${ultimo.texto.length > 80 ? `${ultimo.texto.slice(0, 80)}…` : ultimo.texto}`)}
                </td>
                <td data-label="Fecha">{ultimoMensajeEn && formatDateTime(ultimoMensajeEn)}</td>
                <td data-label="Sin leer">{sinLeer > 0 && <StatusBadge family="wait">{String(sinLeer)}</StatusBadge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
