import { requireUser } from "@/server/modules/auth/auth.http";
import { deleteFile } from "@/server/modules/files/file.service";
import { withErrorHandling } from "@/server/shared/http";

/** Baja lógica de un archivo propio (o de cualquiera, si es admin). */
export const DELETE = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  await deleteFile(user, (await params).id);
  return new Response(null, { status: 204 });
});
