import { requireUser } from "@/server/modules/auth/auth.http";
import { requestDesignChanges } from "@/server/modules/designs/design.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** El cliente pide cambios sobre la versión vigente (RF-26). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json({ solicitud: await requestDesignChanges(user, (await params).id, await readJsonBody(request)) }, { status: 201 });
});
