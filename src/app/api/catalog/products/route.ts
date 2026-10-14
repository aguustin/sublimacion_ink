import { listProducts } from "@/server/modules/catalog/catalog.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) =>
  Response.json(await listProducts(Object.fromEntries(new URL(request.url).searchParams))),
);
