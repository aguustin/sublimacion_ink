import { requireAdmin } from "@/server/modules/auth/auth.http";
import { retryFailedEmail } from "@/server/modules/notifications/outbox.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp } from "@/server/shared/request";

/** Vuelve a encolar un correo que agotó los reintentos (16.3). */
export const POST = withErrorHandling(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(request);
  await retryFailedEmail({ id: admin.id, ip: getClientIp(request) }, (await params).id);
  return new Response(null, { status: 204 });
});
