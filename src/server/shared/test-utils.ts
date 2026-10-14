import pino, { type Logger } from "pino";
import { REDACTED_PATHS } from "./logger";

/** Logger que guarda cada línea en memoria para inspeccionarla en las pruebas. */
export function createMemoryLogger(): { logger: Logger; entries: () => Record<string, unknown>[] } {
  const lines: string[] = [];
  const logger = pino(
    { level: "trace", redact: { paths: REDACTED_PATHS, censor: "[REDACTADO]" } },
    { write: (line: string) => lines.push(line) },
  );
  return { logger, entries: () => lines.map((line) => JSON.parse(line)) };
}
