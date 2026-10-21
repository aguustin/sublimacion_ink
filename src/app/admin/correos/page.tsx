import { requireAdminPage } from "@/app/session";
import { formatDateTime } from "@/lib/orders";
import { listFailedEmails } from "@/server/modules/notifications/outbox.service";
import { RetryEmailButton } from "./retry-email-button";

export const dynamic = "force-dynamic";

/** Correos que agotaron los reintentos (16.3): ninguna notificación se pierde en silencio. */
export default async function FailedEmailsPage() {
  await requireAdminPage();
  const emails = await listFailedEmails();

  return (
    <main>
      <h1>Correos fallidos</h1>
      {emails.length === 0 ? (
        <p>No hay correos fallidos.</p>
      ) : (
        <ul>
          {emails.map((email) => (
            <li key={email.id}>
              {formatDateTime(email.creadoEn)} · {email.destinatario} · {email.asunto} · {email.intentos} intentos · {email.error}{" "}
              <RetryEmailButton emailId={email.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
