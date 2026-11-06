import { requireAdmin } from "@/server/modules/auth/auth.http";
import { getStoreConversation, sendStoreMessage } from "@/server/modules/chat/chat.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ clienteId: string }> };

/** Conversación de un cliente vista por la tienda. Va por cliente para que la tienda pueda escribir primero. */
export const GET = withErrorHandling(async (request, { params }: Params) => {
  await requireAdmin(request);
  return Response.json(await getStoreConversation((await params).clienteId));
});

export const POST = withErrorHandling(async (request, { params }: Params) => {
  const admin = await requireAdmin(request);
  return Response.json({ mensaje: await sendStoreMessage(admin, (await params).clienteId, await readJsonBody(request)) }, { status: 201 });
});
