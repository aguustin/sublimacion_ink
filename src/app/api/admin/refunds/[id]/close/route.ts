import { requireAdmin } from "@/server/modules/auth/auth.http";
import { closeCashRefund } from "@/server/modules/cancellations/settlement.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Cierra una devolución en efectivo arreglada con el cliente (RN-18). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  return Response.json({
    reembolso: await closeCashRefund({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request)),
  });
});
