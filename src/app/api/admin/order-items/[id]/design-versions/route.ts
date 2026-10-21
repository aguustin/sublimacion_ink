import { requireAdmin } from "@/server/modules/auth/auth.http";
import { createDesignVersion } from "@/server/modules/designs/design.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

/** Carga una versión nueva e inmutable del diseño de un ítem (RF-24, 15.3). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  const version = await createDesignVersion({ id: admin.id, ip: getClientIp(request) }, (await params).id, await readJsonBody(request));
  return Response.json({ version }, { status: 201 });
});
