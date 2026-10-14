import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getFilters } from "@/app/api/catalog/filters/route";
import { GET as getProduct } from "@/app/api/catalog/products/[slug]/route";
import { GET as listProducts } from "@/app/api/catalog/products/route";
import sitemap from "@/app/sitemap";
import {
  createCategory,
  createProduct,
  createVariant,
  updateCategory,
  updateProduct,
  updateVariant,
} from "@/server/modules/catalog/catalog-admin.service";
import { getDb } from "@/server/shared/db";
import { apiRequest, params, resetDatabase } from "./helpers";

const actor = { id: crypto.randomUUID() };

async function seed() {
  const tazas = await createCategory(actor, { nombre: "Tazas" });
  const remeras = await createCategory(actor, { nombre: "Remeras" });

  const magica = await createProduct(actor, { nombre: "Taza Mágica", descripcion: "Cambia de color con el calor", categoriaId: tazas.id, tipo: "ESTANDAR" });
  await createVariant(actor, magica.id, { material: "Cerámica", medida: "11 oz", precioCentavos: 1500000 });
  await createVariant(actor, magica.id, { material: "Cerámica", medida: "15 oz", precioCentavos: 1800000 });

  const blanca = await createProduct(actor, { nombre: "Taza blanca", categoriaId: tazas.id, tipo: "ESTANDAR" });
  await createVariant(actor, blanca.id, { material: "Polímero", medida: "11 oz", precioCentavos: 900000 });

  const personalizada = await createProduct(actor, { nombre: "Remera personalizada", categoriaId: remeras.id, tipo: "PERSONALIZABLE" });
  await createVariant(actor, personalizada.id, { material: "Algodón", talle: "M" });

  // No visibles: sin variantes, producto inactivo y categoría inactiva.
  await createProduct(actor, { nombre: "Taza sin variantes", categoriaId: tazas.id, tipo: "ESTANDAR" });
  const inactivo = await createProduct(actor, { nombre: "Taza discontinuada", categoriaId: tazas.id, tipo: "ESTANDAR" });
  await createVariant(actor, inactivo.id, { material: "Vidrio", precioCentavos: 500000 });
  await updateProduct(actor, inactivo.id, { activo: false });
  const oculta = await createCategory(actor, { nombre: "Oculta" });
  const enOculta = await createProduct(actor, { nombre: "Cartel oculto", categoriaId: oculta.id, tipo: "ESTANDAR" });
  await createVariant(actor, enOculta.id, { material: "Chapa", precioCentavos: 700000 });
  await updateCategory(actor, oculta.id, { activa: false });

  return { magica, blanca, personalizada, inactivo };
}

async function search(query = "") {
  const response = await listProducts(apiRequest(`/api/catalog/products${query}`, { method: "GET" }));
  expect(response.status).toBe(200);
  return response.json() as Promise<{ productos: { nombre: string; precioDesdeCentavos: number | null; variasPrecios: boolean }[]; total: number }>;
}

const names = (result: { productos: { nombre: string }[] }) => result.productos.map((product) => product.nombre);

beforeEach(resetDatabase);
afterAll(async () => {
  await getDb().$disconnect();
});

describe("catálogo público (RF-05)", () => {
  it("muestra solo productos activos, de categorías activas y con variantes activas", async () => {
    await seed();
    const result = await search();

    expect(names(result)).toEqual(["Remera personalizada", "Taza blanca", "Taza Mágica"]);
    expect(result.total).toBe(3);
  });

  it("busca sin distinguir acentos ni mayúsculas, también en la descripción", async () => {
    await seed();
    expect(names(await search("?q=MAGICA"))).toEqual(["Taza Mágica"]);
    expect(names(await search("?q=calor"))).toEqual(["Taza Mágica"]);
  });

  it("trata los comodines de la búsqueda como texto", async () => {
    await seed();
    expect((await search("?q=%25")).total).toBe(0);
    expect((await search("?q=_")).total).toBe(0);
  });

  it("filtra por categoría, tipo, material, medida y precio en pesos", async () => {
    await seed();
    expect(names(await search("?categoria=remeras"))).toEqual(["Remera personalizada"]);
    expect(names(await search("?tipo=ESTANDAR"))).toEqual(["Taza blanca", "Taza Mágica"]);
    expect(names(await search("?material=Cer%C3%A1mica&medida=15%20oz"))).toEqual(["Taza Mágica"]);
    // El filtro de precio excluye a los personalizables, que no tienen precio.
    expect(names(await search("?precioMin=10000&precioMax=16000"))).toEqual(["Taza Mágica"]);
    expect(names(await search("?precioMax=9000"))).toEqual(["Taza blanca"]);
  });

  it("muestra el precio mínimo y si hay varios; los personalizables no tienen precio", async () => {
    await seed();
    const byName = Object.fromEntries((await search()).productos.map((product) => [product.nombre, product]));

    expect(byName["Taza Mágica"]).toMatchObject({ precioDesdeCentavos: 1500000, variasPrecios: true });
    expect(byName["Taza blanca"]).toMatchObject({ precioDesdeCentavos: 900000, variasPrecios: false });
    expect(byName["Remera personalizada"]).toMatchObject({ precioDesdeCentavos: null, variasPrecios: false });
  });

  it("ofrece como filtros solo los valores de productos visibles", async () => {
    await seed();
    const options = await (await getFilters(apiRequest("/api/catalog/filters", { method: "GET" }))).json();

    expect(options.categorias.map((category: { slug: string }) => category.slug)).toEqual(["remeras", "tazas"]);
    expect(options.materiales).toEqual(["Algodón", "Cerámica", "Polímero"]);
    expect(options.medidas).toEqual(["11 oz", "15 oz"]);
  });
});

describe("detalle de producto (RF-06)", () => {
  it("devuelve las variantes activas; un producto inactivo da 404", async () => {
    const { magica, inactivo } = await seed();
    const [firstVariant] = (await getDb().variante.findMany({ where: { productoId: magica.id }, orderBy: { creadoEn: "asc" } }));
    await updateVariant(actor, firstVariant!.id, { activa: false });

    const response = await getProduct(apiRequest(`/api/catalog/products/${magica.slug}`, { method: "GET" }), params({ slug: magica.slug }));
    const detail = await response.json();
    expect(detail.variantes.map((variant: { medida: string }) => variant.medida)).toEqual(["15 oz"]);

    const hidden = await getProduct(apiRequest(`/api/catalog/products/${inactivo.slug}`, { method: "GET" }), params({ slug: inactivo.slug }));
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).codigo).toBe("PRODUCTO_NO_ENCONTRADO");
  });

  it("un personalizable no publica precio", async () => {
    const { personalizada } = await seed();
    const response = await getProduct(apiRequest("/", { method: "GET" }), params({ slug: personalizada.slug }));

    expect((await response.json()).variantes[0].precioCentavos).toBeNull();
  });
});

describe("sitemap", () => {
  it("incluye solo los productos visibles", async () => {
    await seed();
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain("http://localhost:3000/productos/taza-magica");
    expect(urls).not.toContain("http://localhost:3000/productos/taza-discontinuada");
    expect(urls).not.toContain("http://localhost:3000/productos/cartel-oculto");
    expect(urls).not.toContain("http://localhost:3000/productos/taza-sin-variantes");
  });
});
