import { requireUser } from "@/server/modules/auth/auth.http";
import { getCustomerOrderDesigns } from "@/server/modules/designs/design.service";
import { withErrorHandling } from "@/server/shared/http";

/** Diseños de un pedido propio, con sus versiones y su estado (RF-28). */
export const GET = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(request);
  return Response.json({ items: await getCustomerOrderDesigns(user, (await params).id) });
});
