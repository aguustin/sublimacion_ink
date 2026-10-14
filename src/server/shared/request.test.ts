import { describe, expect, it } from "vitest";
import { assertSameOrigin, getClientIp, readJsonBody } from "./request";

const APP = "https://tienda.ejemplo";

const post = (headers: Record<string, string>) => new Request(`${APP}/api/x`, { method: "POST", headers });

describe("assertSameOrigin", () => {
  it("acepta un POST del propio sitio", () => {
    expect(() => assertSameOrigin(post({ origin: APP }), APP)).not.toThrow();
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "same-origin" }), APP)).not.toThrow();
  });

  it("rechaza un POST de otro origen", () => {
    expect(() => assertSameOrigin(post({ origin: "https://malicioso.ejemplo" }), APP)).toThrow(
      expect.objectContaining({ code: "ORIGEN_NO_PERMITIDO", status: 403 }),
    );
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "cross-site" }), APP)).toThrow(
      expect.objectContaining({ code: "ORIGEN_NO_PERMITIDO" }),
    );
  });

  it("acepta un cliente que no es navegador (sin Origin ni Sec-Fetch-Site)", () => {
    expect(() => assertSameOrigin(post({}), APP)).not.toThrow();
  });

  it("no verifica métodos que no modifican datos", () => {
    const get = new Request(`${APP}/api/x`, { headers: { origin: "https://malicioso.ejemplo" } });
    expect(() => assertSameOrigin(get, APP)).not.toThrow();
  });
});

describe("readJsonBody", () => {
  it("rechaza un cuerpo que no es JSON con un error del cliente", async () => {
    const request = new Request(`${APP}/api/x`, { method: "POST", body: "{no es json" });
    await expect(readJsonBody(request)).rejects.toMatchObject({ code: "JSON_INVALIDO", status: 400 });
  });
});

describe("getClientIp", () => {
  it("usa el primer valor de X-Forwarded-For", () => {
    expect(getClientIp(post({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
  });

  it("indica que la IP es desconocida si el proxy no la informa", () => {
    expect(getClientIp(post({}))).toBe("desconocida");
  });
});
