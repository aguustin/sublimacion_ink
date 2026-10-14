import { AppError } from "./errors";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Protección CSRF (sección 17): una solicitud que modifica datos debe venir del propio sitio.
 * Los navegadores envían `Origin` o `Sec-Fetch-Site`; un cliente que no envía ninguno
 * (curl, cron) no lleva cookies de un usuario por sí solo, así que no es un vector CSRF.
 */
export function assertSameOrigin(request: Request, allowedOrigin: string): void {
  if (!UNSAFE_METHODS.has(request.method)) return;

  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin !== new URL(allowedOrigin).origin) throw forbiddenOrigin();
    return;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") throw forbiddenOrigin();
}

function forbiddenOrigin(): AppError {
  return new AppError("ORIGEN_NO_PERMITIDO", "La solicitud no proviene del sitio.", 403);
}

/** Cuerpo JSON de la solicitud; un cuerpo mal formado es un error del cliente, no un 500. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("JSON_INVALIDO", "El cuerpo de la solicitud no es un JSON válido.", 400);
  }
}

/**
 * IP del cliente según el proxy del hosting. Se usa solo para limitar solicitudes,
 * nunca para autorizar; el límite por email no depende de este valor.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "desconocida";
}
