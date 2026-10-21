import { reconcileStock } from "@/server/modules/inventory/stock.service";
import { assertCronAuthorized } from "@/server/shared/cron";
import { withErrorHandling } from "@/server/shared/http";

/** Cron externo, una vez por día: conciliación de stock (14.8). Solo informa; las diferencias quedan en el log. */
export const POST = withErrorHandling(async (request) => {
  assertCronAuthorized(request);
  return Response.json({ diferencias: (await reconcileStock()).length });
});
