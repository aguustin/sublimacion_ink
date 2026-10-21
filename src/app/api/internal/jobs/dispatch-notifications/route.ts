import { dispatchOutbox } from "@/server/modules/notifications/outbox.service";
import { assertCronAuthorized } from "@/server/shared/cron";
import { withErrorHandling } from "@/server/shared/http";

/** Cron externo, cada 1 minuto: envía los correos encolados y reintenta los fallidos (16.3). */
export const POST = withErrorHandling(async (request) => {
  assertCronAuthorized(request);
  return Response.json(await dispatchOutbox());
});
