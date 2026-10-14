import { getProductBySlug } from "@/server/modules/catalog/catalog.service";
import { withErrorHandling } from "@/server/shared/http";

export const GET = withErrorHandling(async (_request, { params }: { params: Promise<{ slug: string }> }) =>
  Response.json(await getProductBySlug((await params).slug)),
);
