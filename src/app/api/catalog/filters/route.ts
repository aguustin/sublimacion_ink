import { getFilterOptions } from "@/server/modules/catalog/catalog.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => Response.json(await getFilterOptions()));
