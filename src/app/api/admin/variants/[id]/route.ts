import { requireAdmin } from "@/server/modules/auth/auth.http";
import { updateVariant } from "@/server/modules/catalog/catalog-admin.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const PATCH = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const actor = { id: admin.id, ip: getClientIp(request) };
  return Response.json({ variante: await updateVariant(actor, (await params).id, await readJsonBody(request)) });
});
