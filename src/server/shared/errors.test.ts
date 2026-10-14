import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, toErrorResponse } from "./errors";

describe("toErrorResponse", () => {
  it("usa el código, el mensaje y el estado de un AppError", () => {
    const error = new AppError("STOCK_INSUFICIENTE", "No hay stock suficiente.", 409, { varianteId: "v1" });

    expect(toErrorResponse(error)).toEqual({
      status: 409,
      body: { codigo: "STOCK_INSUFICIENTE", mensaje: "No hay stock suficiente.", detalles: { varianteId: "v1" } },
    });
  });

  it("convierte un error de validación en 422 con los campos inválidos", () => {
    const result = z.object({ email: z.email() }).safeParse({ email: "no-es-email" });

    const { status, body } = toErrorResponse(result.error);

    expect(status).toBe(422);
    expect(body.codigo).toBe("VALIDACION");
    expect(body.detalles).toEqual([{ campo: "email", mensaje: expect.any(String) }]);
  });

  it("oculta los detalles de un error inesperado", () => {
    const { status, body } = toErrorResponse(new Error("connection string postgres://user:pass@host"));

    expect(status).toBe(500);
    expect(body.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(body)).not.toContain("pass@host");
  });
});
