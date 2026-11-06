import { requireAdmin } from "@/server/modules/auth/auth.http";
import { registerDelayCompensation } from "@/server/modules/orders/delay-compensation.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Compensación por demora cargada a mano, con su devolución (RN-04, D-05). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await registerDelayCompensation({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json({ ajuste: result }, { status: 201 });
});
