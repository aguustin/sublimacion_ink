import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig } from "@/server/shared/config";

// Puerto del almacenamiento de objetos (16.1). La implementación S3 sirve para MinIO en local y
// para el proveedor de producción; la de memoria, solo para las pruebas.

export type SignedUrlOptions = { expiresInSeconds: number; contentType: string; fileName: string };

export type ObjectStorage = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL temporal de descarga. Se llama solo después de autorizar. */
  signedGetUrl(key: string, options: SignedUrlOptions): Promise<string>;
};

/** `filename*` (RFC 6266) para que los acentos del nombre original sobrevivan a la descarga. */
const contentDisposition = (fileName: string) => `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;

function s3Storage(): ObjectStorage {
  const config = getConfig();
  const bucket = config.S3_BUCKET;
  const client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    // MinIO y la mayoría de los compatibles con S3 usan rutas, no subdominios por bucket.
    forcePathStyle: Boolean(config.S3_ENDPOINT),
    credentials: { accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! },
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    signedGetUrl(key, { expiresInSeconds, contentType, fileName }) {
      // El tipo de la respuesta lo fija el servidor con el tipo detectado, no el que se subió.
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: contentDisposition(fileName),
      });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },
  };
}

const memoryObjects = new Map<string, { body: Uint8Array; contentType: string }>();

/** Pruebas: guarda los objetos en memoria. */
export const memoryStorage: ObjectStorage = {
  async put(key, body, contentType) {
    memoryObjects.set(key, { body, contentType });
  },
  async delete(key) {
    memoryObjects.delete(key);
  },
  async signedGetUrl(key, { expiresInSeconds }) {
    return `memoria://${key}?expira=${expiresInSeconds}`;
  },
};

export function getMemoryObjects(): ReadonlyMap<string, { body: Uint8Array; contentType: string }> {
  return memoryObjects;
}

export function clearMemoryObjects(): void {
  memoryObjects.clear();
}

let cached: ObjectStorage | undefined;

export function getStorage(): ObjectStorage {
  cached ??= getConfig().STORAGE_PROVIDER === "memoria" ? memoryStorage : s3Storage();
  return cached;
}
