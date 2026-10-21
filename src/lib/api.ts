export type ApiError = {
  codigo: string;
  mensaje: string;
  detalles?: unknown;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const NETWORK_ERROR: ApiError = { codigo: "SIN_CONEXION", mensaje: "No pudimos conectarnos. Revisá tu conexión." };

/** Solicitud con cuerpo JSON a la API propia; nunca lanza, devuelve el error con su código estable. */
export async function sendJson<T = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: (data as ApiError | null) ?? NETWORK_ERROR };
  return { ok: true, data: data as T };
}

export function postJson<T = unknown>(url: string, body?: unknown): Promise<ApiResult<T>> {
  return sendJson<T>("POST", url, body);
}

/** Mensajes por campo de un error de validación (`VALIDACION`). */
export function fieldErrors(error: ApiError | null): Record<string, string> {
  if (error?.codigo !== "VALIDACION" || !Array.isArray(error.detalles)) return {};
  return Object.fromEntries(
    (error.detalles as { campo: string; mensaje: string }[]).map(({ campo, mensaje }) => [campo, mensaje]),
  );
}
