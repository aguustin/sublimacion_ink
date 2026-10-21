import { requireAdmin } from "@/server/modules/auth/auth.http";
import { startProduction } from "@/server/modules/designs/design.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Transición administrativa (9.3). En INC-09 solo `EN_PRODUCCION` (RN-07); listo, despacho y entrega llegan en INC-12. */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  return Response.json(await startProduction({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request)));
});
