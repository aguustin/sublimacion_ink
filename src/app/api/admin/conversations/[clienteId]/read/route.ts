import { requireAdmin } from "@/server/modules/auth/auth.http";
import { markReadByStore } from "@/server/modules/chat/chat.service";
import { withErrorHandling } from "@/server/shared/http";

/** La tienda leyó los mensajes de ese cliente. */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ clienteId: string }> }) => {
  await requireAdmin(request);
  return Response.json(await markReadByStore((await params).clienteId));
});
