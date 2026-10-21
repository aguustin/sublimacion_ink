import { requireUser } from "@/server/modules/auth/auth.http";
import { createAddress, listAddresses } from "@/server/modules/users/profile.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) =>
  Response.json({ direcciones: await listAddresses((await requireUser(request)).id) }),
);

export const POST = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  return Response.json({ direccion: await createAddress(user.id, await readJsonBody(request)) }, { status: 201 });
});
