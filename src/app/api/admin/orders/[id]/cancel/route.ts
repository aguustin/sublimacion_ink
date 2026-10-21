import { requireAdmin } from "@/server/modules/auth/auth.http";
import { cancelByStore } from "@/server/modules/cancellations/cancellation.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** La tienda cancela un pedido, sin cargo y con devolución total (F-05, RN-19). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const cancelacion = await cancelByStore({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json({ cancelacion });
});
