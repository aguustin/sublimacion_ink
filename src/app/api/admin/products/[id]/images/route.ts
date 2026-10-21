import { requireAdmin } from "@/server/modules/auth/auth.http";
import { attachProductImage } from "@/server/modules/catalog/product-images.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Asocia al producto una imagen ya subida con contexto PRODUCTO (RF-07). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const imagen = await attachProductImage({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json({ imagen }, { status: 201 });
});
