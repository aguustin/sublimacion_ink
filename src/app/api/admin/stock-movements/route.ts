import { requireAdmin } from "@/server/modules/auth/auth.http";
import { listMovements } from "@/server/modules/inventory/stock.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

/** `?varianteId=` o `?materialId=`. */
export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json({ movimientos: await listMovements(Object.fromEntries(new URL(request.url).searchParams)) });
});
