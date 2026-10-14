import { describe, expect, it } from "vitest";
import { readGuestCart, safeNextPath } from "./guest-cart";

describe("safeNextPath", () => {
  it("acepta rutas internas y rechaza destinos externos", () => {
    expect(safeNextPath("/carrito", "/cuenta")).toBe("/carrito");
    expect(safeNextPath("//malicioso.ejemplo", "/cuenta")).toBe("/cuenta");
    expect(safeNextPath("https://malicioso.ejemplo", "/cuenta")).toBe("/cuenta");
    expect(safeNextPath(null, "/cuenta")).toBe("/cuenta");
  });
});

describe("readGuestCart", () => {
  it("devuelve un carrito vacío si el navegador no tiene almacenamiento", () => {
    expect(readGuestCart()).toEqual([]);
  });
});
