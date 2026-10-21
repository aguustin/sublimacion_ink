import { requireAdmin } from "@/server/modules/auth/auth.http";
import { createHoliday, listHolidays } from "@/server/modules/orders/holidays.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

/** `?anio=` (por defecto, el actual). */
export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json({ feriados: await listHolidays(new URL(request.url).searchParams.get("anio") ?? undefined) });
});

/** Agrega un feriado y extiende las reservas vigentes que lo incluyen (RN-29). */
export const POST = withErrorHandling(async (request) => {
  const admin = await requireAdmin(request);
  return Response.json(await createHoliday({ id: admin.id, ip: getClientIp(request) }, await readJsonBody(request)), { status: 201 });
});
