import { requireAdmin } from "@/server/modules/auth/auth.http";
import { getAdminOrder } from "@/server/modules/orders/orders.service";
import { withErrorHandling } from "@/server/shared/http";

export const GET = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(request);
  return Response.json({ pedido: await getAdminOrder((await params).id) });
});
