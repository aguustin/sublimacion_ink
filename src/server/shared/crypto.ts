import { createHash, randomBytes } from "node:crypto";

/** Token aleatorio de 256 bits, apto para una URL o una cookie. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lo que se guarda en la base: si se filtra, no sirve para usar el token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
