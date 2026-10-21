import { requireAdmin } from "@/server/modules/auth/auth.http";
import { deleteHoliday } from "@/server/modules/orders/holidays.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp } from "@/server/shared/request";

/** Quitar un feriado no acorta las reservas ya creadas (RN-29). */
export const DELETE = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  await deleteHoliday({ id: admin.id, ip: getClientIp(request) }, (await params).id);
  return new Response(null, { status: 204 });
});
