import type { Logger } from "pino";
import { getConfig } from "./config";
import { toErrorResponse } from "./errors";
import { logger as defaultLogger } from "./logger";
import { assertSameOrigin } from "./request";

export const REQUEST_ID_HEADER = "x-request-id";

type Handler<Context> = (request: Request, context: Context) => Promise<Response>;
/** El contexto es opcional para poder invocar el handler en pruebas sin parámetros de ruta. */
type WrappedHandler<Context> = (request: Request, context?: Context) => Promise<Response>;

export type RouteOptions = {
  logger?: Logger;
  /** Origen permitido para métodos que modifican datos; por defecto, `APP_URL`. */
  allowedOrigin?: string;
};

/**
 * Envuelve un route handler: asigna un id de solicitud, rechaza solicitudes de otro origen
 * que modifican datos (CSRF), registra el resultado y convierte los errores en respuestas
 * con código estable (RNF-08, RNF-12, sección 17).
 */
export function withErrorHandling<Context = unknown>(
  handler: Handler<Context>,
  { logger = defaultLogger, allowedOrigin }: RouteOptions = {},
): WrappedHandler<Context> {
  return async (request, context) => {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
    const log = logger.child({ requestId, method: request.method, path: new URL(request.url).pathname });
    const startedAt = performance.now();

    let response: Response;
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        assertSameOrigin(request, allowedOrigin ?? getConfig().APP_URL);
      }
      response = await handler(request, context as Context);
    } catch (error) {
      const { status, body } = toErrorResponse(error);
      if (status >= 500) {
        log.error({ err: error }, "error en la solicitud");
      } else {
        log.warn({ codigo: body.codigo }, "solicitud rechazada");
      }
      response = Response.json(body, { status });
    }

    response.headers.set(REQUEST_ID_HEADER, requestId);
    log.info({ status: response.status, ms: Math.round(performance.now() - startedAt) }, "solicitud atendida");
    return response;
  };
}
