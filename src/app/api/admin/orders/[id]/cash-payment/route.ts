import { requireAdmin } from "@/server/modules/auth/auth.http";
import { registerCashPayment } from "@/server/modules/orders/order-payment.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readOptionalJsonBody } from "@/server/shared/request";

/** Registra un pago en efectivo: el total o la seña de una reserva vigente (RF-19), o el saldo al retirar (RN-21). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await registerCashPayment({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readOptionalJsonBody(request));
  return Response.json(result, { status: 201 });
});
