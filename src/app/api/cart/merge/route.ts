import { requireUser } from "@/server/modules/auth/auth.http";
import { mergeGuestCart } from "@/server/modules/cart/cart.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** Carrito del navegador → carrito del cliente, después de iniciar sesión o registrarse (RN-25). */
export const POST = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  return Response.json(await mergeGuestCart(user.id, await readJsonBody(request)));
});
