import { requireUser } from "@/server/modules/auth/auth.http";
import { assertSimulatedPaymentsEnabled, paySimulated } from "@/server/modules/orders/order-payment.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** Pago online SIMULADO: no mueve dinero (RN-09). Responde 404 si el modo simulado está desactivado. */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ orderId: string }> }) => {
  assertSimulatedPaymentsEnabled();
  const user = await requireUser(request);
  return Response.json(await paySimulated(user, (await params).orderId, await readJsonBody(request)), { status: 201 });
});
