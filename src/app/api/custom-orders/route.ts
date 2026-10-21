import { requireUser } from "@/server/modules/auth/auth.http";
import { createCustomRequest } from "@/server/modules/orders/custom-order.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** Solicitud de personalización (RF-22); `Idempotency-Key` evita pedidos duplicados. */
export const POST = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  const result = await createCustomRequest(user, await readJsonBody(request), request.headers.get("idempotency-key"));
  return Response.json({ pedido: { id: result.pedidoId, numero: result.numero } }, { status: result.creado ? 201 : 200 });
});
