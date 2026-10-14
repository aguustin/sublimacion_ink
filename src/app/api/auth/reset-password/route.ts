import { clearedSessionCookie } from "@/server/modules/auth/auth.http";
import { resetPassword } from "@/server/modules/auth/auth.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const POST = withErrorHandling(async (request) => {
  await resetPassword(await readJsonBody(request), getClientIp(request));
  const response = Response.json({ mensaje: "Tu contraseña cambió. Iniciá sesión con la nueva." });
  response.headers.append("Set-Cookie", clearedSessionCookie());
  return response;
});
