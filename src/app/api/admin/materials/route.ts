import { requireAdmin } from "@/server/modules/auth/auth.http";
import { createMaterial, getInventoryOverview } from "@/server/modules/inventory/stock.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json({ materiales: (await getInventoryOverview()).materiales });
});

export const POST = withErrorHandling(async (request) => {
  const admin = await requireAdmin(request);
  const material = await createMaterial({ id: admin.id, ip: getClientIp(request) }, await readJsonBody(request));
  return Response.json({ material }, { status: 201 });
});
