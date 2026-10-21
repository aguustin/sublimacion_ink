import { requireAdmin } from "@/server/modules/auth/auth.http";
import { addExclusion, listExclusions } from "@/server/modules/orders/cancellation-window.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Fechas excluidas de la ventana de 48 h (RN-30, RF-59). */
export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json({ fechas: await listExclusions() });
});

/** Agrega una fecha: recalcula las ventanas afectadas y avisa a esos clientes (F-09). */
export const POST = withErrorHandling(async (request) => {
  const admin = await requireAdmin(request);
  return Response.json(await addExclusion({ id: admin.id, ip: getClientIp(request) }, await readJsonBody(request)), { status: 201 });
});
