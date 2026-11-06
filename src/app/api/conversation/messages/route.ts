import { requireUser } from "@/server/modules/auth/auth.http";
import { getClientMessages, sendClientMessage } from "@/server/modules/chat/chat.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

/** Mensajes del cliente con la tienda (16.2): la interfaz los vuelve a pedir cada pocos segundos. */
export const GET = withErrorHandling(async (request) => Response.json({ mensajes: await getClientMessages(await requireUser(request)) }));

export const POST = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  return Response.json({ mensaje: await sendClientMessage(user, await readJsonBody(request)) }, { status: 201 });
});
