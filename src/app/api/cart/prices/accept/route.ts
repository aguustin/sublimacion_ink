import { requireUser } from "@/server/modules/auth/auth.http";
import { acceptCurrentPrices } from "@/server/modules/cart/cart.service";
import { withErrorHandling } from "@/server/shared/http";

export const POST = withErrorHandling(async (request) =>
  Response.json(await acceptCurrentPrices((await requireUser(request)).id)),
);
