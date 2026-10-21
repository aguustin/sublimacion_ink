import { expireShippingQuotes } from "@/server/modules/orders/expiration.service";
import { assertCronAuthorized } from "@/server/shared/cron";
import { withErrorHandling } from "@/server/shared/http";

/** Cron externo, cada 15 minutos: cancela los envíos sin cotizar o sin respuesta en 48 h (D-46). Idempotente. */
export const POST = withErrorHandling(async (request) => {
  assertCronAuthorized(request);
  return Response.json(await expireShippingQuotes());
});
