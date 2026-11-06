import { requireAdmin } from "@/server/modules/auth/auth.http";
import { registerReceipt } from "@/server/modules/orders/receipt.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Registra una factura o una nota de crédito emitida fuera del sistema, con su PDF opcional (RN-26). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const result = await registerReceipt({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json({ comprobante: result }, { status: 201 });
});
