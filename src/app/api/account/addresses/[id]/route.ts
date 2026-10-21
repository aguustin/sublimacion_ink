import { requireUser } from "@/server/modules/auth/auth.http";
import { deleteAddress, updateAddress } from "@/server/modules/users/profile.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

type Context = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request, { params }: Context) => {
  const user = await requireUser(request);
  return Response.json({ direccion: await updateAddress(user.id, (await params).id, await readJsonBody(request)) });
});

export const DELETE = withErrorHandling(async (request, { params }: Context) => {
  const user = await requireUser(request);
  await deleteAddress(user.id, (await params).id);
  return new Response(null, { status: 204 });
});
