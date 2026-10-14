import { requireAdmin } from "@/server/modules/auth/auth.http";
import { listCustomers } from "@/server/modules/users/customers.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  return Response.json(await listCustomers({ q: params.get("q") ?? undefined, pagina: params.get("pagina") ?? undefined }));
});
