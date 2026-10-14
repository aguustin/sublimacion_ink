import { describe, expect, it } from "vitest";
import { hashToken } from "@/server/shared/crypto";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword", () => {
  it("usa Argon2id con los parámetros de OWASP y verifica la contraseña correcta", async () => {
    const hash = await hashPassword("una-clave-larga");

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain("una-clave-larga");
    expect(await verifyPassword(hash, "una-clave-larga")).toBe(true);
    expect(await verifyPassword(hash, "otra-clave")).toBe(false);
  });

  it("genera un hash distinto cada vez (sal aleatoria)", async () => {
    expect(await hashPassword("igual")).not.toBe(await hashPassword("igual"));
  });

  it("devuelve false ante un hash corrupto en lugar de fallar", async () => {
    expect(await verifyPassword("no-es-un-hash", "x")).toBe(false);
  });
});

describe("hashToken", () => {
  it("es determinista y no contiene el token", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
