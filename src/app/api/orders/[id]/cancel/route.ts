import { requireUser } from "@/server/modules/auth/auth.http";
import { cancelByClient } from "@/server/modules/cancellations/cancellation.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** El cliente cancela un pedido propio con las condiciones que vio en la vista previa (F-04). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json({ cancelacion: await cancelByClient(user, (await params).id, await readJsonBody(request)) });
});
