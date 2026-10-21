import { requireAdmin } from "@/server/modules/auth/auth.http";
import { extendReservation } from "@/server/modules/orders/reservation-admin.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Extiende una reserva vigente (RN-28). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await extendReservation({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json(result);
});
