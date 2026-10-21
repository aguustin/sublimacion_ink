import { requireUser } from "@/server/modules/auth/auth.http";
import { approveDesignVersion } from "@/server/modules/designs/design.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** El cliente aprueba la versión vigente con la huella que vio (RF-25, 15.2). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json({ aprobacion: await approveDesignVersion(user, (await params).id, await readJsonBody(request)) }, { status: 201 });
});
