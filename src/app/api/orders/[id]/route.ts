import { requireUser } from "@/server/modules/auth/auth.http";
import { getCustomerOrder } from "@/server/modules/orders/orders.service";
import { withErrorHandling } from "@/server/shared/http";

export const GET = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json({ pedido: await getCustomerOrder(user.id, (await params).id) });
});
