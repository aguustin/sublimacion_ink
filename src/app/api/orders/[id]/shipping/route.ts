import { requireUser } from "@/server/modules/auth/auth.http";
import { getShippingQuoteView } from "@/server/modules/orders/shipping-quote.service";
import { withErrorHandling } from "@/server/shared/http";

/** Cotización vigente del envío y total a precios de hoy (F-10). */
export const GET = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json(await getShippingQuoteView(user.id, (await params).id));
});
