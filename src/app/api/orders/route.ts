import { requireUser } from "@/server/modules/auth/auth.http";
import { listCustomerOrders } from "@/server/modules/orders/orders.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) =>
  Response.json({ pedidos: await listCustomerOrders((await requireUser(request)).id) }),
);
