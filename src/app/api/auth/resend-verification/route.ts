import { requireUser } from "@/server/modules/auth/auth.http";
import { resendVerification } from "@/server/modules/auth/auth.service";
import { withErrorHandling } from "@/server/shared/http";

export const POST = withErrorHandling(async (request) => {
  await resendVerification(await requireUser(request));
  return Response.json({ mensaje: "Si tu email todavía no está confirmado, te enviamos un enlace nuevo." }, { status: 202 });
});
