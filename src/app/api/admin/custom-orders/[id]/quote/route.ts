import { requireAdmin } from "@/server/modules/auth/auth.http";
import { quoteCustomOrder } from "@/server/modules/orders/custom-order.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Emite o reemplaza la cotización de un personalizado en definición (D-10). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const cotizacion = await quoteCustomOrder({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json({ cotizacion }, { status: 201 });
});
