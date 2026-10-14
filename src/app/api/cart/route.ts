import { requireUser } from "@/server/modules/auth/auth.http";
import { getCart } from "@/server/modules/cart/cart.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => Response.json(await getCart((await requireUser(request)).id)));
