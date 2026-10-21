import { requireUser } from "@/server/modules/auth/auth.http";
import { switchToPickup } from "@/server/modules/orders/shipping-quote.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** El cliente cambia el envío por retiro en el local (D-47). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json(await switchToPickup(user, (await params).id, await readJsonBody(request)));
});
