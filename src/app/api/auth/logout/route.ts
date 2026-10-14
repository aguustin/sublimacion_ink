import { clearedSessionCookie, readSessionToken } from "@/server/modules/auth/auth.http";
import { logout } from "@/server/modules/auth/auth.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp } from "@/server/shared/request";

export const POST = withErrorHandling(async (request) => {
  await logout(readSessionToken(request), getClientIp(request));
  const response = new Response(null, { status: 204 });
  response.headers.append("Set-Cookie", clearedSessionCookie());
  return response;
});
