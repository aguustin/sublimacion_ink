import { requireAdmin } from "@/server/modules/auth/auth.http";
import { listAdminCoupons } from "@/server/modules/coupons/coupon.service";
import { withErrorHandling } from "@/server/shared/http";

/** Cupones emitidos, filtrables por estado (RF-54). */
export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  const estado = new URL(request.url).searchParams.get("estado") ?? undefined;
  return Response.json({ cupones: await listAdminCoupons({ estado }) });
});
