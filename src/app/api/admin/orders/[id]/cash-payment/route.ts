import { requireAdmin } from "@/server/modules/auth/auth.http";
import { registerCashPayment } from "@/server/modules/orders/order-payment.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp } from "@/server/shared/request";

/** Registra el pago en efectivo de una reserva vigente (RF-19). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await registerCashPayment({ id: admin.id, ip: getClientIp(request) }, (await params).id);
  return Response.json(result, { status: 201 });
});
