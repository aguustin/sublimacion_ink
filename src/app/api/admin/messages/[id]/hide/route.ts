import { requireAdmin } from "@/server/modules/auth/auth.http";
import { hideMessage } from "@/server/modules/chat/chat.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** La tienda oculta un mensaje del chat, con motivo auditado (16.2). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  return Response.json(await hideMessage(admin, (await params).id, await readJsonBody(request)));
});
