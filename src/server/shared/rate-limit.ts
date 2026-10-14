import type { DbClient } from "./db";
import { AppError } from "./errors";

export type RateLimit = {
  /** Máximo de solicitudes por ventana. */
  limit: number;
  windowSeconds: number;
};

/**
 * Cuenta una solicitud para `key` en la ventana actual y rechaza con 429 si se superó el límite.
 * El contador vive en PostgreSQL: es atómico y vale aunque haya varias instancias o reinicios.
 */
export async function consumeRateLimit(db: DbClient, key: string, { limit, windowSeconds }: RateLimit): Promise<void> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  const [row] = await db.$queryRaw<{ cantidad: number }[]>`
    INSERT INTO limite_solicitud (clave, ventana_inicio, cantidad)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (clave, ventana_inicio) DO UPDATE SET cantidad = limite_solicitud.cantidad + 1
    RETURNING cantidad`;

  if ((row?.cantidad ?? 0) > limit) {
    const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000);
    throw new AppError("DEMASIADOS_INTENTOS", "Hiciste demasiados intentos. Esperá unos minutos.", 429, {
      reintentarEnSegundos: retryAfterSeconds,
    });
  }
}
