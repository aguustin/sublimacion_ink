import { requireUser } from "@/server/modules/auth/auth.http";
import { declineShipping } from "@/server/modules/orders/shipping-quote.service";
import { withErrorHandling } from "@/server/shared/http";

/** El cliente no acepta el envío y cancela sin cargo (D-47, D-49). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json(await declineShipping(user, (await params).id));
});
