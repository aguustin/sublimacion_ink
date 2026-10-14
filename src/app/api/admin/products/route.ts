import { requireAdmin } from "@/server/modules/auth/auth.http";
import { createProduct, listAdminProducts } from "@/server/modules/catalog/catalog-admin.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json(await listAdminProducts(Object.fromEntries(new URL(request.url).searchParams)));
});

export const POST = withErrorHandling(async (request) => {
  const admin = await requireAdmin(request);
  const product = await createProduct({ id: admin.id, ip: getClientIp(request) }, await readJsonBody(request));
  return Response.json({ producto: product }, { status: 201 });
});
