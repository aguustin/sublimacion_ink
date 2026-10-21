import { requireAdmin } from "@/server/modules/auth/auth.http";
import { executeRefund } from "@/server/modules/cancellations/settlement.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp } from "@/server/shared/request";

/** Ejecuta un reembolso online simulado ya calculado (RF-42). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  return Response.json({ reembolso: await executeRefund({ id: admin.id, ip: getClientIp(request) }, (await params).id) });
});
