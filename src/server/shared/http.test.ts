import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { REQUEST_ID_HEADER, withErrorHandling } from "./http";
import { createMemoryLogger } from "./test-utils";

const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/prueba", { headers });

describe("withErrorHandling", () => {
  it("devuelve la respuesta del handler con un id de solicitud nuevo", async () => {
    const { logger } = createMemoryLogger();
    const handler = withErrorHandling(async () => Response.json({ ok: true }), { logger });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("conserva el id de solicitud recibido", async () => {
    const { logger } = createMemoryLogger();
    const handler = withErrorHandling(async () => new Response(null, { status: 204 }), { logger });

    const response = await handler(request({ [REQUEST_ID_HEADER]: "abc-123" }));

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("abc-123");
  });

  it("convierte un AppError en su respuesta con código estable", async () => {
    const { logger, entries } = createMemoryLogger();
    const handler = withErrorHandling(async () => {
      throw new AppError("CARRITO_VACIO", "El carrito está vacío.", 422);
    }, { logger });

    const response = await handler(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ codigo: "CARRITO_VACIO", mensaje: "El carrito está vacío." });
    expect(entries().some((entry) => entry.level === 40 && entry.codigo === "CARRITO_VACIO")).toBe(true);
  });

  it("responde 500 genérico ante un error inesperado y lo registra con su id", async () => {
    const { logger, entries } = createMemoryLogger();
    const handler = withErrorHandling(async () => {
      throw new Error("detalle interno");
    }, { logger });

    const response = await handler(request({ [REQUEST_ID_HEADER]: "req-1" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(body)).not.toContain("detalle interno");

    const errorEntry = entries().find((entry) => entry.level === 50);
    expect(errorEntry).toMatchObject({ requestId: "req-1", path: "/api/prueba" });
  });
});
