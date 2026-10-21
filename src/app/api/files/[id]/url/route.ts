import { requireUser } from "@/server/modules/auth/auth.http";
import { getFileUrl } from "@/server/modules/files/file.service";
import { withErrorHandling } from "@/server/shared/http";

/** URL firmada de corta duración, solo después de autorizar (16.1, T-41). */
export const GET = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  const result = await getFileUrl(user, (await params).id);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});
