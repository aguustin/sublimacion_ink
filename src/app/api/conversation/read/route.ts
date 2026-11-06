import { requireUser } from "@/server/modules/auth/auth.http";
import { markReadByClient } from "@/server/modules/chat/chat.service";
import { withErrorHandling } from "@/server/shared/http";

/** El cliente leyó los mensajes de la tienda. */
export const POST = withErrorHandling(async (request) => Response.json(await markReadByClient(await requireUser(request))));
