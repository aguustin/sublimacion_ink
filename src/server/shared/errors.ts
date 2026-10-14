import { z } from "zod";

/** Error de negocio con un código estable que el cliente puede interpretar (RNF-12). */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export type ErrorBody = {
  codigo: string;
  mensaje: string;
  detalles?: unknown;
};

export const INTERNAL_ERROR_CODE = "ERROR_INTERNO";
export const VALIDATION_ERROR_CODE = "VALIDACION";

/** Convierte cualquier error en la respuesta pública, sin exponer trazas ni detalles internos. */
export function toErrorResponse(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: { codigo: error.code, mensaje: error.message, detalles: error.details },
    };
  }

  if (error instanceof z.ZodError) {
    return {
      status: 422,
      body: {
        codigo: VALIDATION_ERROR_CODE,
        mensaje: "Los datos enviados no son válidos.",
        detalles: error.issues.map((issue) => ({ campo: issue.path.join("."), mensaje: issue.message })),
      },
    };
  }

  return {
    status: 500,
    body: { codigo: INTERNAL_ERROR_CODE, mensaje: "Ocurrió un error inesperado. Intentá de nuevo más tarde." },
  };
}
