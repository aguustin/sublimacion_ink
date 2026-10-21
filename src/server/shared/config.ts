import { z } from "zod";

const configSchema = z
  .object({
    APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "Debe ser una URL de PostgreSQL." }),
    /** URL pública del sitio: enlaces de los correos y origen permitido para solicitudes que modifican datos. */
    APP_URL: z.url({ protocol: /^https?$/, error: "Debe ser una URL http(s)." }),
    /** `consola` escribe los correos en el log; `memoria` los guarda para las pruebas. Solo valen en local. */
    EMAIL_PROVIDER: z.enum(["consola", "memoria"]).default("consola"),
    /** v1: solo pagos simulados (RN-09). `desactivado` apaga el endpoint de pago simulado (T-48). */
    PAYMENTS_MODE: z.enum(["simulado", "desactivado"]).default("simulado"),
    /** Secreto del cron externo para los procesos periódicos (14.5). Sin él, esos endpoints no existen. */
    CRON_SECRET: z.string().min(32, "Debe tener al menos 32 caracteres.").optional(),
    /** Archivos (16.1): `s3` (MinIO en local, el proveedor de producción después) o `memoria` (solo pruebas). */
    STORAGE_PROVIDER: z.enum(["s3", "memoria"]).default("s3"),
    /** Vacío usa AWS; en local, el MinIO de docker-compose.yml. */
    S3_ENDPOINT: z.url({ protocol: /^https?$/, error: "Debe ser una URL http(s)." }).optional(),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_BUCKET: z.string().min(3).default("sublimaciones"),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** D-08: tamaño máximo por archivo. 20 MB en local; revisar con archivos de impresión reales antes de producción. */
    FILES_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(20 * 1024 * 1024),
    /** Vigencia de las URLs firmadas de descarga, en segundos (16.1: «minutos»). */
    FILES_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  })
  .refine((config) => config.STORAGE_PROVIDER === "memoria" || (config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY), {
    path: ["S3_ACCESS_KEY_ID"],
    message: "Faltan las credenciales del almacenamiento S3.",
  })
  .refine((config) => config.STORAGE_PROVIDER === "s3" || config.APP_ENV === "local", {
    path: ["STORAGE_PROVIDER"],
    message: "El almacenamiento en memoria solo vale en local.",
  })
  .refine((config) => config.APP_ENV === "local", {
    path: ["EMAIL_PROVIDER"],
    message: "Fuera de local hace falta un proveedor de correo real (pendiente de elegir).",
  });

export type Config = z.infer<typeof configSchema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    // Solo se informan los nombres de las variables y el problema, nunca sus valores.
    throw new Error(`Configuración inválida:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cachedConfig: Config | undefined;

export function getConfig(): Config {
  cachedConfig ??= parseConfig(process.env);
  return cachedConfig;
}
