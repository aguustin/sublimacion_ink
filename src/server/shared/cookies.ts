export type CookieOptions = {
  maxAgeSeconds: number;
  secure: boolean;
};

/** Lee una cookie del encabezado `Cookie` de la solicitud. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

/** Cookie no accesible desde JavaScript y no enviada en solicitudes cruzadas de tipo POST (sección 17). */
export function serializeCookie(name: string, value: string, { maxAgeSeconds, secure }: CookieOptions): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
