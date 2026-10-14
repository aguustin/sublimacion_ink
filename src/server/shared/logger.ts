import pino, { type DestinationStream, type Logger } from "pino";

// Datos que nunca deben quedar en los logs (especificación, sección 17).
export const REDACTED_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "cookie",
  "*.cookie",
  "authorization",
  "*.authorization",
  "headers.cookie",
  "headers.authorization",
  "*.headers.cookie",
  "*.headers.authorization",
];

export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      base: { app: "sublimaciones", env: process.env.APP_ENV ?? "local" },
      redact: { paths: REDACTED_PATHS, censor: "[REDACTADO]" },
    },
    destination,
  );
}

export const logger = createLogger();
