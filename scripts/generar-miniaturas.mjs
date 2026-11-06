// Genera la miniatura de las imágenes subidas antes de INC-07 (v1.35). Uso: npm run archivos:miniaturas
// Idempotente: solo procesa imágenes activas sin miniatura. Las que no se pueden procesar quedan sin
// miniatura, como al subirlas, y los listados muestran el original.
// Usa los mismos parámetros que src/server/modules/files/thumbnail.ts: si cambian allá, cambiarlos acá.
import "dotenv/config";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import sharp from "sharp";

const THUMBNAIL_SIZE = 480;
const MAX_INPUT_PIXELS = 50_000_000;

if (process.env.STORAGE_PROVIDER !== "s3") {
  console.error("Este script trabaja sobre el almacenamiento S3 (STORAGE_PROVIDER=s3).");
  process.exit(1);
}

const bucket = process.env.S3_BUCKET;
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let generated = 0;
let failed = 0;
try {
  const { rows } = await db.query(
    `SELECT id, clave_objeto FROM archivo
     WHERE estado = 'ACTIVO' AND clave_miniatura IS NULL AND tipo_mime_detectado IN ('image/jpeg', 'image/png', 'image/webp')`,
  );
  for (const { id, clave_objeto: key } of rows) {
    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await object.Body.transformToByteArray();
      const thumbnail = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
        .timeout({ seconds: 10 })
        .rotate()
        .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();
      const thumbnailKey = `${key}.miniatura.webp`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: thumbnailKey, Body: thumbnail, ContentType: "image/webp" }));
      // Condicional: si otro proceso ya la generó, no se pisa.
      await db.query("UPDATE archivo SET clave_miniatura = $1 WHERE id = $2 AND clave_miniatura IS NULL", [thumbnailKey, id]);
      generated++;
    } catch (error) {
      failed++;
      console.warn(`Sin miniatura para ${id}: ${error.message}`);
    }
  }
  console.log(`Imágenes sin miniatura: ${rows.length}. Generadas: ${generated}. Sin poder procesar: ${failed}.`);
} finally {
  await db.end();
}
