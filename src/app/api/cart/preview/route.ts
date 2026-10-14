import { previewGuestCart } from "@/server/modules/cart/cart.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** Vista del carrito de un visitante (guardado en su navegador), con precios y stock actuales. No guarda nada. */
export const POST = withErrorHandling(async (request) => Response.json(await previewGuestCart(await readJsonBody(request))));
