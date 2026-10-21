import { requireUser } from "@/server/modules/auth/auth.http";
import { rejectCustomQuote } from "@/server/modules/orders/custom-order.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** El cliente rechaza la cotización; el pedido sigue en definición. */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  await rejectCustomQuote(user, (await params).id, await readJsonBody(request));
  return new Response(null, { status: 204 });
});
