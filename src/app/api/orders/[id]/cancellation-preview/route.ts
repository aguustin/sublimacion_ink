import { requireUser } from "@/server/modules/auth/auth.http";
import { previewClientCancellation } from "@/server/modules/cancellations/cancellation.service";
import { withErrorHandling } from "@/server/shared/http";

/** Regla y desglose que aplicaría si el cliente cancela ahora (F-04 paso 3, RN-24). */
export const GET = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json(await previewClientCancellation(user, (await params).id));
});
