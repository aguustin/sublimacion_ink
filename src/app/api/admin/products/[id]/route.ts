import { requireAdmin } from "@/server/modules/auth/auth.http";
import { getAdminProduct, updateProduct } from "@/server/modules/catalog/catalog-admin.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

type Context = { params: Promise<{ id: string }> };

export const GET = withErrorHandling(async (request, { params }: Context) => {
  await requireAdmin(request);
  return Response.json({ producto: await getAdminProduct((await params).id) });
});

export const PATCH = withErrorHandling(async (request, { params }: Context) => {
  const admin = await requireAdmin(request);
  const actor = { id: admin.id, ip: getClientIp(request) };
  return Response.json({ producto: await updateProduct(actor, (await params).id, await readJsonBody(request)) });
});
