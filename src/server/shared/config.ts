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
