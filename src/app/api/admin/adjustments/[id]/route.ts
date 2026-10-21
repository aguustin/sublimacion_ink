import { requireAdmin } from "@/server/modules/auth/auth.http";
import { updateEstimatedRealCost } from "@/server/modules/cancellations/settlement.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Edita el costo real estimado de un cargo (RF-53); no cambia el cargo. */
export const PATCH = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  return Response.json({
    ajuste: await updateEstimatedRealCost({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request)),
  });
});
