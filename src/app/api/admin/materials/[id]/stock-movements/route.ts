import { requireAdmin } from "@/server/modules/auth/auth.http";
import { registerMaterialMovement } from "@/server/modules/inventory/stock.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const actor = { id: admin.id, ip: getClientIp(request) };
  const stock = await registerMaterialMovement(actor, (await params).id, await readJsonBody(request));
  return Response.json({ stock }, { status: 201 });
});
