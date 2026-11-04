import { requireAdminPage } from "@/app/session";
import { formatDateTime } from "@/lib/orders";
import { listFailedEmails } from "@/server/modules/notifications/outbox.service";
import { PageHeader } from "../page-header";
import { RetryEmailButton } from "./retry-email-button";

export const dynamic = "force-dynamic";

/** Correos que agotaron los reintentos (16.3): ninguna notificación se pierde en silencio. */
export default async function FailedEmailsPage() {
  await requireAdminPage();
  const emails = await listFailedEmails();

  return (
    <main>
      <PageHeader title="Correos fallidos" href="/admin/correos" />
      {emails.length === 0 ? (
        <p>No hay correos fallidos.</p>
      ) : (
        <table className="ink-table-cards">
          <thead>
            <tr>
              <th>Asunto</th>
              <th>Destinatario</th>
              <th>Fecha</th>
              <th>Intentos</th>
              <th>Error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {emails.map((email) => (
              <tr key={email.id}>
                <td>{email.asunto}</td>
                <td data-label="Destinatario">{email.destinatario}</td>
                <td data-label="Fecha">{formatDateTime(email.creadoEn)}</td>
                <td data-label="Intentos">{email.intentos}</td>
                <td data-label="Error">{email.error}</td>
                <td>
                  <RetryEmailButton emailId={email.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
