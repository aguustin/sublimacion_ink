import { getHealth } from "@/server/modules/health/health.service";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => Response.json(getHealth()));
