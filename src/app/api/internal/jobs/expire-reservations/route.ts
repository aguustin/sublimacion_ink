import { expireCashReservations } from "@/server/modules/orders/expiration.service";
import { assertCronAuthorized } from "@/server/shared/cron";
import { withErrorHandling } from "@/server/shared/http";

/** Cron externo, cada 5 minutos: vence las reservas en efectivo impagas (RN-06). Idempotente. */
export const POST = withErrorHandling(async (request) => {
  assertCronAuthorized(request);
  return Response.json(await expireCashReservations());
});
