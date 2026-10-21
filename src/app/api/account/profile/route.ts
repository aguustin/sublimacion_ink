import { requireUser } from "@/server/modules/auth/auth.http";
import { updateProfile } from "@/server/modules/users/profile.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => Response.json({ usuario: await requireUser(request) }));

export const PATCH = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  return Response.json({ usuario: await updateProfile(user.id, await readJsonBody(request)) });
});
