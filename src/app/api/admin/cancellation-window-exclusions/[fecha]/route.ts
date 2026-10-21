import { requireAdmin } from "@/server/modules/auth/auth.http";
import { removeExclusion } from "@/server/modules/orders/cancellation-window.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp } from "@/server/shared/request";

/** Quita una fecha excluida: recalcula las ventanas afectadas y avisa (F-09 paso 3). */
export const DELETE = withErrorHandling(async (request, { params }: { params: Promise<{ fecha: string }> }) => {
  const admin = await requireAdmin(request);
  return Response.json(await removeExclusion({ id: admin.id, ip: getClientIp(request) }, (await params).fecha));
});
