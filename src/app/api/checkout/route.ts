import { requireUser } from "@/server/modules/auth/auth.http";
import { checkout } from "@/server/modules/orders/checkout.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** Confirma el carrito como pedido. `Idempotency-Key` evita pedidos duplicados por reintentos (RF-21). */
export const POST = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  const result = await checkout(user, await readJsonBody(request), request.headers.get("idempotency-key"));
  return Response.json({ pedido: { id: result.pedidoId, numero: result.numero } }, { status: result.creado ? 201 : 200 });
});
