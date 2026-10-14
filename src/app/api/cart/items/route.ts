import { requireUser } from "@/server/modules/auth/auth.http";
import { addItem } from "@/server/modules/cart/cart.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

export const POST = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  return Response.json(await addItem(user.id, await readJsonBody(request)));
});
