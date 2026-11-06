import { requireAdmin } from "@/server/modules/auth/auth.http";
import { updateTracking } from "@/server/modules/orders/delivery.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Corrige el transportista y el código de seguimiento de un envío despachado (RF-43). */
export const PATCH = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await updateTracking({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json({ entrega: result });
});
