import { requireUser } from "@/server/modules/auth/auth.http";
import { acceptCustomQuote } from "@/server/modules/orders/custom-order.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** El cliente acepta la cotización vigente: empieza el plazo de la seña (RN-17). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json(await acceptCustomQuote(user, (await params).id, await readJsonBody(request)));
});
