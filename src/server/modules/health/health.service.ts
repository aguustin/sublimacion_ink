import { getConfig } from "@/server/shared/config";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

export type HealthStatus = {
  estado: "ok";
  entorno: string;
};

export type ReadinessStatus = HealthStatus & {
  baseDeDatos: "ok";
};

/** El proceso está vivo. No consulta dependencias externas. */
export function getHealth(): HealthStatus {
  return { estado: "ok", entorno: getConfig().APP_ENV };
}

/** El proceso puede atender solicitudes: la base de datos responde. */
export async function getReadiness(db: Db = getDb()): Promise<ReadinessStatus> {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new AppError("BASE_DE_DATOS_NO_DISPONIBLE", "La base de datos no está disponible.", 503, undefined, {
      cause: error,
    });
  }
  return { ...getHealth(), baseDeDatos: "ok" };
}
