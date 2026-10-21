import { requireUser } from "@/server/modules/auth/auth.http";
import { previewQuoteAcceptance } from "@/server/modules/orders/custom-order.service";
import { withErrorHandling } from "@/server/shared/http";

/** Total y seña que resultarían de aceptar la cotización vigente, con un cupón opcional (RN-21). */
export const GET = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  const codigoCupon = new URL(request.url).searchParams.get("cupon") || undefined;
  return Response.json(await previewQuoteAcceptance(user, (await params).id, codigoCupon));
});
