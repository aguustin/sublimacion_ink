import sharp from "sharp";
import type { AllowedMime } from "./file.policy";

// Miniaturas (16.1, INC-07): una versión WEBP chica de cada imagen para los listados, así no se
// descarga el original (que puede ser de impresión, varios MB) solo para mostrar una tarjeta.

/** Lado mayor de la miniatura, en píxeles: alcanza para tarjetas y vistas previas. */
export const THUMBNAIL_SIZE = 480;

/**
 * Límite contra imágenes «bomba» (pocos bytes que se descomprimen en miles de megapíxeles): por
 * encima, sharp rechaza la imagen sin decodificarla. 50 MP cubre una foto de impresión de 90 × 90 cm.
 */
const MAX_INPUT_PIXELS = 50_000_000;

const IMAGE_TYPES: readonly AllowedMime[] = ["image/jpeg", "image/png", "image/webp"];

export const hasThumbnail = (mime: AllowedMime) => IMAGE_TYPES.includes(mime);

/** Genera la miniatura de una imagen ya validada por su firma. Lanza si no se puede (quien llama decide). */
export async function makeThumbnail(bytes: Uint8Array): Promise<Uint8Array> {
  const output = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
    .timeout({ seconds: 10 })
    // Respeta la orientación de la cámara (EXIF) y descarta los metadatos: la miniatura no los lleva.
    .rotate()
    .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  return new Uint8Array(output);
}
