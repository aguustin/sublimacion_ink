import { requireAdmin } from "@/server/modules/auth/auth.http";
import { reissueCustomQuote } from "@/server/modules/orders/custom-order.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Reemite la cotización de un personalizado vencido en un pedido nuevo vinculado (D-42). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await reissueCustomQuote({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json(result, { status: 201 });
});
