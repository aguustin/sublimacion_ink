import { requireAdmin } from "@/server/modules/auth/auth.http";
import { listAdminOrders } from "@/server/modules/orders/orders.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json(await listAdminOrders(Object.fromEntries(new URL(request.url).searchParams)));
});
