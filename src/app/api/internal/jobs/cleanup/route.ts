import { cleanupExpiredRecords } from "@/server/jobs/cleanup";
import { assertCronAuthorized } from "@/server/shared/cron";
import { withErrorHandling } from "@/server/shared/http";

/** Cron externo, una vez por día: borra sesiones, tokens y contadores vencidos (R-22). */
export const POST = withErrorHandling(async (request) => {
  assertCronAuthorized(request);
  return Response.json(await cleanupExpiredRecords());
});
