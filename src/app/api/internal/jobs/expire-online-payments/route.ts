import { expireOnlinePayments } from "@/server/modules/orders/expiration.service";
import { assertCronAuthorized } from "@/server/shared/cron";
import { withErrorHandling } from "@/server/shared/http";

/** Cron externo, cada 1 minuto: vence los pagos online pendientes (RN-22). Idempotente. */
export const POST = withErrorHandling(async (request) => {
  assertCronAuthorized(request);
  return Response.json(await expireOnlinePayments());
});
