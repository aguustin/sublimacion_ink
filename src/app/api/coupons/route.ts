import { requireUser } from "@/server/modules/auth/auth.http";
import { listCustomerCoupons } from "@/server/modules/coupons/coupon.service";
import { withErrorHandling } from "@/server/shared/http";

/** "Mis cupones" (RF-50). */
export const GET = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  return Response.json({ cupones: await listCustomerCoupons(user.id) });
});
