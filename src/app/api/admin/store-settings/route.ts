import { requireAdmin } from "@/server/modules/auth/auth.http";
import { getStoreContact, updateStoreSettings } from "@/server/modules/store-settings/store-settings.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json({ configuracion: await getStoreContact() });
});

export const PUT = withErrorHandling(async (request) => {
  const admin = await requireAdmin(request);
  const settings = await updateStoreSettings({ id: admin.id, ip: getClientIp(request) }, await readJsonBody(request));
  return Response.json({ configuracion: settings });
});
