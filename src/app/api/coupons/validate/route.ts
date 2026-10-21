import { requireUser } from "@/server/modules/auth/auth.http";
import { getCart } from "@/server/modules/cart/cart.service";
import { previewCoupon } from "@/server/modules/coupons/coupon.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** Vista previa del descuento sobre el carrito actual (F-08 paso 1); no lo consume. */
export const POST = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  const body = (await readJsonBody(request)) as { codigo?: unknown } | null;
  const cart = await getCart(user.id);
  return Response.json(await previewCoupon(user.id, body?.codigo, cart.subtotalCentavos));
});
