import { requireAdmin } from "@/server/modules/auth/auth.http";
import { quoteShipping } from "@/server/modules/orders/shipping-quote.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** La tienda cotiza el envío o indica que no puede enviar (F-10, D-49). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await quoteShipping({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json(result, { status: 201 });
});
