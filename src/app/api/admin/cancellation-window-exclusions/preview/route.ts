import { requireAdmin } from "@/server/modules/auth/auth.http";
import { previewExclusionChange } from "@/server/modules/orders/cancellation-window.service";
import { withErrorHandling } from "@/server/shared/http";
import { readJsonBody } from "@/server/shared/request";

/** Pedidos cuya ventana cambiaría al agregar o quitar una fecha, sin modificar nada (F-09 paso 1). */
export const POST = withErrorHandling(async (request) => {
  await requireAdmin(request);
  return Response.json(await previewExclusionChange(await readJsonBody(request)));
});
