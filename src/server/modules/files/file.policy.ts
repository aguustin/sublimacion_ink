import { randomUUID } from "node:crypto";
import type { ContextoArchivo } from "@/generated/prisma/client";

// Reglas de los archivos (16.1, D-08), en un solo lugar.

/** D-08: los únicos tipos admitidos en la v1. AI, PSD, CDR, SVG y HTML quedan afuera. */
export const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;

export type AllowedMime = keyof typeof ALLOWED_TYPES;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * Tipo según el contenido real (firma del archivo), sin mirar la extensión ni el tipo que declara
 * el cliente. Un HTML o un ejecutable con extensión `.jpg` no tiene la firma de JPEG y se rechaza.
 */
export function detectFileType(bytes: Uint8Array): AllowedMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  return null;
}

/** El nombre original es solo un dato: sin rutas ni caracteres de control, y acotado. */
export function sanitizeOriginalName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (clean || "archivo").slice(0, 200);
}

/** Clave del objeto generada por el servidor: contexto y un UUID, con la extensión del tipo detectado. */
export function objectKeyFor(contexto: ContextoArchivo, mime: AllowedMime): string {
  return `${contexto.toLowerCase()}/${randomUUID()}.${ALLOWED_TYPES[mime]}`;
}

/** Contextos que puede usar cada rol hoy. Los demás se habilitan con la etapa que los asocia a un pedido. */
export const CLIENT_CONTEXTS: readonly ContextoArchivo[] = ["REFERENCIA", "CHAT"];
export const ADMIN_CONTEXTS: readonly ContextoArchivo[] = ["PRODUCTO", "VERSION_DISENO"];
