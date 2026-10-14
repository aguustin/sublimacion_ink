import { requireUser } from "@/server/modules/auth/auth.http";
import { withErrorHandling } from "@/server/shared/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request) => Response.json({ usuario: await requireUser(request) }));
