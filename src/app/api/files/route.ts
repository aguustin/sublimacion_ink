import { requireUser } from "@/server/modules/auth/auth.http";
import { tooLarge, uploadFile } from "@/server/modules/files/file.service";
import { getConfig } from "@/server/shared/config";
import { AppError } from "@/server/shared/errors";
import { withErrorHandling } from "@/server/shared/http";

/** Margen para los encabezados del multipart y el campo del contexto. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Subida de un archivo (16.1): multipart con `archivo` y `contexto`. */
export const POST = withErrorHandling(async (request) => {
  const user = await requireUser(request);
  const maxBytes = getConfig().FILES_MAX_BYTES;
  // D-08: un cuerpo declarado más grande que el máximo se rechaza sin leerlo.
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes + MULTIPART_OVERHEAD_BYTES) throw tooLarge(maxBytes);

  const form = await request.formData().catch(() => {
    throw new AppError("FORMULARIO_INVALIDO", "Enviá el archivo como multipart/form-data.", 400);
  });
  const archivo = await uploadFile(user, { file: form.get("archivo"), contexto: form.get("contexto") }, { maxBytes });
  return Response.json({ archivo }, { status: 201 });
});
