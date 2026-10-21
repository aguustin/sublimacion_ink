import { requireAdmin } from "@/server/modules/auth/auth.http";
import { closeAdjustment } from "@/server/modules/cancellations/settlement.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Cierra un cargo pendiente de arreglo: cobrado, condonado o incobrable (RN-18). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  return Response.json({ ajuste: await closeAdjustment({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request)) });
});
