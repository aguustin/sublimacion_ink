import { requestPasswordReset } from "@/server/modules/auth/auth.service";
import { withErrorHandling } from "@/server/shared/http";
import { getClientIp, readJsonBody } from "@/server/shared/request";

export const POST = withErrorHandling(async (request) => {
  await requestPasswordReset(await readJsonBody(request), getClientIp(request));
  return Response.json(
    { mensaje: "Si existe una cuenta con ese email, te enviamos un enlace para restablecer la contraseña." },
    { status: 202 },
  );
});
