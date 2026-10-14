import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

describe("createLogger", () => {
  it("redacta contraseñas, tokens, cookies y cabeceras de autorización", () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line: string) => lines.push(line) });

    logger.info(
      {
        password: "clave-1",
        user: { password: "clave-2", token: "tok-1" },
        req: { headers: { authorization: "Bearer abc", cookie: "sesion=xyz" } },
      },
      "prueba",
    );

    const output = lines.join("");
    for (const secret of ["clave-1", "clave-2", "tok-1", "Bearer abc", "sesion=xyz"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[REDACTADO]");
  });

  it("identifica la aplicación en cada línea", () => {
    const lines: string[] = [];
    createLogger({ write: (line: string) => lines.push(line) }).info("hola");

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ app: "sublimaciones", msg: "hola" });
  });
});
