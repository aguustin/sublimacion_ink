import { sessionCookie } from "@/server/modules/auth/auth.http";
import { register } from "@/server/modules/auth/auth.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const POST = withErrorHandling(async (request) => {
  const { user, session } = await register(await readJsonBody(request), getClientIp(request));
  const response = Response.json({ usuario: user }, { status: 201 });
  response.headers.append("Set-Cookie", sessionCookie(session));
  return response;
});
