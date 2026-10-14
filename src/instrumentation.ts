import type { Instrumentation } from "next";

// Se ejecuta una vez al iniciar el servidor.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

// Errores no controlados durante el renderizado o en route handlers (RNF-08).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/server/shared/logger");
  logger.error(
    { err: error, method: request.method, path: request.path, routeType: context.routeType },
    "error no controlado",
  );
};
