import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";

const validEnv = {
  DATABASE_URL: "postgresql://usuario:clave@localhost:5432/base",
  APP_URL: "http://localhost:3000",
};

describe("parseConfig", () => {
  it("aplica valores por defecto a las variables opcionales", () => {
    expect(parseConfig(validEnv)).toEqual({
      APP_ENV: "local",
      LOG_LEVEL: "info",
      EMAIL_PROVIDER: "consola",
      PAYMENTS_MODE: "simulado",
      ...validEnv,
    });
  });

  it("rechaza un ambiente desconocido", () => {
    expect(() => parseConfig({ ...validEnv, APP_ENV: "qa" })).toThrow(/APP_ENV/);
  });

  it("rechaza staging y producción sin un proveedor de correo real", () => {
    for (const APP_ENV of ["staging", "production"]) {
      expect(() => parseConfig({ ...validEnv, APP_ENV })).toThrow(/EMAIL_PROVIDER/);
    }
  });

  it("rechaza una URL que no es de PostgreSQL sin mostrar su valor", () => {
    const secret = "mysql://admin:super-secreta@db:3306/x";
    let message = "";
    try {
      parseConfig({ ...validEnv, DATABASE_URL: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain("super-secreta");
  });

  it("exige DATABASE_URL y APP_URL", () => {
    expect(() => parseConfig({})).toThrow(/DATABASE_URL[\s\S]*APP_URL|APP_URL[\s\S]*DATABASE_URL/);
  });
});
