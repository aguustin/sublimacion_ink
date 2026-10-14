import { requireAdmin } from "@/server/modules/auth/auth.http";
import { createCategory, listCategories } from "@/server/modules/catalog/catalog-admin.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json({ categorias: await listCategories() });
});

export const POST = withErrorHandling(async (request) => {
  const admin = await requireAdmin(request);
  const category = await createCategory({ id: admin.id, ip: getClientIp(request) }, await readJsonBody(request));
  return Response.json({ categoria: category }, { status: 201 });
});
