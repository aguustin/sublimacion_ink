import { describe, expect, it } from "vitest";
import { formatPesos, priceLabel } from "@/lib/money";
import { catalogFiltersSchema } from "./catalog.schemas";
import { escapeLike } from "./catalog.service";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("quita acentos, símbolos y espacios repetidos", () => {
    expect(slugify("  Taza Mágica 11 oz! ")).toBe("taza-magica-11-oz");
    expect(slugify("Remera Ñandú — Talle M")).toBe("remera-nandu-talle-m");
  });

  it("toma el primer slug libre", async () => {
    const taken = new Set(["taza", "taza-2"]);
    expect(await uniqueSlug("Taza", async (slug) => taken.has(slug))).toBe("taza-3");
    expect(await uniqueSlug("¡¡!!", async () => false)).toBe("item");
  });
});

describe("catalogFiltersSchema", () => {
  it("ignora campos vacíos y valores inválidos en lugar de fallar", () => {
    expect(catalogFiltersSchema.parse({ q: "", tipo: "OTRO", precioMin: "abc", pagina: "-3" })).toEqual({
      q: undefined,
      categoria: undefined,
      tipo: undefined,
      material: undefined,
      medida: undefined,
      pagina: 1,
      precioMinCentavos: undefined,
      precioMaxCentavos: undefined,
    });
  });

  it("convierte los precios de pesos a centavos", () => {
    const filters = catalogFiltersSchema.parse({ precioMin: "1500", precioMax: "2999.99", tipo: "ESTANDAR", pagina: "2" });
    expect(filters).toMatchObject({ precioMinCentavos: 150000, precioMaxCentavos: 299999, tipo: "ESTANDAR", pagina: 2 });
  });
});

describe("escapeLike", () => {
  it("escapa los comodines de LIKE", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("precios en pantalla (RN-26)", () => {
  it("formatea centavos como pesos argentinos", () => {
    expect(formatPesos(1234550).replace(/\s/g, " ")).toBe("$ 12.345,50");
  });

  it("muestra «Consultá el precio» si no hay precio y «Desde» si hay varios", () => {
    expect(priceLabel(null)).toBe("Consultá el precio");
    expect(priceLabel(150000, true).replace(/\s/g, " ")).toBe("Desde $ 1.500,00");
  });
});
