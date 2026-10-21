import { requireAdmin } from "@/server/modules/auth/auth.http";
import { removeProductImage } from "@/server/modules/catalog/product-images.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp } from "@/server/shared/request";

/** Quita una imagen del producto y da de baja el archivo. */
export const DELETE = withErrorHandling(async (request, { params }: { params: Promise<{ id: string; archivoId: string }> }) => {
  const admin = await requireAdmin(request);
  const { id, archivoId } = await params;
  await removeProductImage({ id: admin.id, ip: getClientIp(request) }, id, archivoId);
  return new Response(null, { status: 204 });
});
