import { getConfig } from "@/server/shared/config";
import { logger } from "@/server/shared/logger";

// Con una configuración inválida el proceso termina: un despliegue mal configurado no debe parecer sano.
try {
  getConfig();
} catch (error) {
  logger.fatal({ err: error }, "el servidor no arranca");
  process.exit(1);
}
