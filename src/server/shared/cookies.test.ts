import { describe, expect, it } from "vitest";
import { readCookie, serializeCookie } from "./cookies";

describe("readCookie", () => {
  it("lee una cookie entre varias", () => {
    const request = new Request("http://localhost/", { headers: { cookie: "otra=1; sesion=abc%2B1; tema=claro" } });
    expect(readCookie(request, "sesion")).toBe("abc+1");
  });

  it("devuelve undefined si no existe", () => {
    expect(readCookie(new Request("http://localhost/"), "sesion")).toBeUndefined();
  });
});

describe("serializeCookie", () => {
  it("marca la cookie como HttpOnly y SameSite=Lax", () => {
    const cookie = serializeCookie("sesion", "abc", { maxAgeSeconds: 60, secure: false });
    expect(cookie).toBe("sesion=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=60");
  });

  it("agrega Secure fuera de local", () => {
    expect(serializeCookie("sesion", "abc", { maxAgeSeconds: 60, secure: true })).toMatch(/; Secure$/);
  });
});
