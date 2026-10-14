import { requireUser } from "@/server/modules/auth/auth.http";
import { removeItem, updateItem } from "@/server/modules/cart/cart.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

type Context = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request, { params }: Context) => {
  const user = await requireUser(request);
  return Response.json(await updateItem(user.id, (await params).id, await readJsonBody(request)));
});

export const DELETE = withErrorHandling(async (request, { params }: Context) => {
  const user = await requireUser(request);
  return Response.json(await removeItem(user.id, (await params).id));
});
