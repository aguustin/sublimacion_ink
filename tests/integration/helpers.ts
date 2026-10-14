import { clearSentEmails, getSentEmails } from "@/server/modules/notifications/email";
import { getDb } from "@/server/shared/db";

export const APP_URL = "http://localhost:3000";

/** Deja la base de pruebas vacía entre casos. */
export async function resetDatabase(): Promise<void> {
  await getDb().$executeRawUnsafe(
    "TRUNCATE pago, historial_estado_pedido, item_pedido, notificacion, salida_notificacion, item_carrito, carrito, retencion_stock, pedido, usuario, sesion, token_usuario, evento_auditoria, limite_solicitud, movimiento_stock, material, variante, producto, categoria CASCADE",
  );
  clearSentEmails();
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Valor `nombre=valor` de la cookie de sesión. */
  cookie?: string;
  /** Por defecto, el propio sitio; `null` simula un cliente que no envía Origin. */
  origin?: string | null;
};

export function apiRequest(path: string, { method = "POST", body, cookie, origin = APP_URL }: RequestOptions = {}) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (origin && method !== "GET") headers.origin = origin;
  return new Request(`${APP_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** `sesion=<token>` tomado del Set-Cookie de la respuesta. */
export function sessionCookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie?.startsWith("sesion=")) throw new Error("La respuesta no inició sesión.");
  return cookie;
}

/** Token del último correo enviado (proveedor `memoria`). */
export function tokenFromLastEmail(): string {
  const token = getSentEmails().at(-1)?.text.match(/token=([\w-]+)/)?.[1];
  if (!token) throw new Error("No hay un correo con token.");
  return token;
}

export const params = <T extends Record<string, string>>(values: T) => ({ params: Promise.resolve(values) });

/** Pedido mínimo para pruebas que necesitan un pedido existente (por ejemplo, retenciones de stock). */
export async function createTestOrder(): Promise<string> {
  const db = getDb();
  const client = await db.usuario.create({
    data: { email: `cliente-${crypto.randomUUID()}@ejemplo.com`, nombre: "Cliente de prueba", hashContrasena: "-" },
  });
  const order = await db.pedido.create({
    data: {
      clienteId: client.id,
      estado: "PENDIENTE_PAGO",
      modalidadCierre: "ONLINE",
      modalidadEntrega: "RETIRO",
      subtotalProductosCentavos: 0,
      totalCentavos: 0,
      claveIdempotencia: crypto.randomUUID(),
    },
  });
  return order.id;
}
