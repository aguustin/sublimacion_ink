import { timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";
import { AppError } from "./errors";

/**
 * Solo el cron externo llama a los procesos periódicos (14.5): `Authorization: Bearer <CRON_SECRET>`.
 * Sin secreto configurado, los endpoints no existen (404).
 */
export function assertCronAuthorized(request: Request, secret = getConfig().CRON_SECRET): void {
  if (!secret) throw new AppError("NO_ENCONTRADO", "No encontrado.", 404);
  const received = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new AppError("NO_AUTORIZADO", "No autorizado.", 401);
  }
}
