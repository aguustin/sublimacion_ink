import { requireAdmin } from "@/server/modules/auth/auth.http";
import { getReactivationPreview, reactivateReservation } from "@/server/modules/orders/reservation-admin.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

type Context = { params: Promise<{ id: string }> };

/** Vista previa: precios vigentes, total y disponibilidad. */
export const GET = withErrorHandling(async (request, { params }: Context) => {
  await requireAdmin(request);
  return Response.json(await getReactivationPreview((await params).id));
});

/** Reactiva una reserva estándar vencida, si se puede volver a retener todo el stock (RN-28). */
export const POST = withErrorHandling(async (request, { params }: Context) => {
  const admin = await requireAdmin(request);
  const result = await reactivateReservation({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json(result);
});
