import { requireAdmin } from "@/server/modules/auth/auth.http";
import { getInventoryOverview, reconcileStock } from "@/server/modules/inventory/stock.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

/** Stock de variantes y materiales (`?bajo=1`: solo stock bajo) y resultado de la conciliación. */
export const GET = withErrorHandling(async (request) => {
  await requireAdmin(request);
  const onlyLow = new URL(request.url).searchParams.get("bajo") === "1";
  const [overview, diferencias] = await Promise.all([getInventoryOverview({ onlyLow }), reconcileStock()]);
  return Response.json({ ...overview, conciliacion: { diferencias } });
});
