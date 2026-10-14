import { verifyEmail } from "@/server/modules/auth/auth.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

export const POST = withErrorHandling(async (request) => {
  await verifyEmail(await readJsonBody(request));
  return Response.json({ mensaje: "Tu email quedó confirmado." });
});
