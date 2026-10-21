import { requireUser } from "@/server/modules/auth/auth.http";
import { acceptShippingQuote } from "@/server/modules/orders/shipping-quote.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** El cliente acepta la cotización del envío y pasa a pagar online (F-10). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json(await acceptShippingQuote(user, (await params).id, await readJsonBody(request)));
});
