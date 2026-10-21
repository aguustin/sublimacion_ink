import { requireAdmin } from "@/server/modules/auth/auth.http";
import { voidCoupon } from "@/server/modules/coupons/coupon.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Anula un cupón activo, con motivo (RF-54). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  return Response.json({ cupon: await voidCoupon({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request)) });
});
