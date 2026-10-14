import { requireAdmin } from "@/server/modules/auth/auth.http";
import { unblockCustomer } from "@/server/modules/users/customers.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  await unblockCustomer(admin.id, (await params).id, await readJsonBody(request), getClientIp(request));
  return new Response(null, { status: 204 });
});
