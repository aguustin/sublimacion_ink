import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "./auth.schemas";

const valid = { nombre: "Ana", email: "  Ana@Ejemplo.COM ", contrasena: "una-clave-larga" };

describe("registerSchema", () => {
  it("normaliza el email y descarta un teléfono vacío", () => {
    expect(registerSchema.parse({ ...valid, telefono: "  " })).toEqual({
      nombre: "Ana",
      email: "ana@ejemplo.com",
      contrasena: "una-clave-larga",
      telefono: undefined,
    });
  });

  it("exige al menos 8 caracteres de contraseña", () => {
    const result = registerSchema.safeParse({ ...valid, contrasena: "corta" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["contrasena"]);
  });

  it("rechaza un email inválido y un teléfono con letras", () => {
    expect(registerSchema.safeParse({ ...valid, email: "no-es-email" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, telefono: "llamame" }).success).toBe(false);
  });

  it("acepta un teléfono con prefijo internacional", () => {
    expect(registerSchema.parse({ ...valid, telefono: "+54 11 5555-1234" }).telefono).toBe("+54 11 5555-1234");
  });
});

describe("loginSchema", () => {
  it("no aplica la longitud mínima al iniciar sesión", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", contrasena: "x" }).success).toBe(true);
  });
});
