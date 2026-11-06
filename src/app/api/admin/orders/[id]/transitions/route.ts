import { requireAdmin } from "@/server/modules/auth/auth.http";
import { startProduction } from "@/server/modules/designs/design.service";
import { advanceDelivery, DELIVERY_STATES } from "@/server/modules/orders/delivery.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Transición administrativa (9.3): `EN_PRODUCCION` (RN-07) o un paso de la entrega (INC-12: listo, despachado, entregado). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const actor = { id: admin.id, ip: getClientIp(request) };
  const body = await readJsonBody(request);
  const estado = (body as { estado?: unknown } | null)?.estado;
  const id = (await params).id;
  return Response.json(DELIVERY_STATES.includes(estado as never) ? await advanceDelivery(actor, id, body) : await startProduction(actor, id, body));
});
