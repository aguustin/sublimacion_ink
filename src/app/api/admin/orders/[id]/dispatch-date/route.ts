import { requireAdmin } from "@/server/modules/auth/auth.http";
import { setDispatchDate } from "@/server/modules/orders/dispatch-date.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Confirma o cambia la fecha comprometida de despacho o de disponibilidad para retiro (RN-14). */
export const PUT = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await setDispatchDate({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json({ pedido: result });
});
