import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { DELETE as removeItemRoute, PATCH as updateItemRoute } from "@/app/api/cart/items/[id]/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as mergeRoute } from "@/app/api/cart/merge/route";
import { POST as previewRoute } from "@/app/api/cart/preview/route";
import { POST as acceptPricesRoute } from "@/app/api/cart/prices/accept/route";
import { GET as getCartRoute } from "@/app/api/cart/route";
import type { CartView } from "@/server/modules/cart/cart.service";
import { createCategory, createProduct, createVariant, updateProduct, updateVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { getDb } from "@/server/shared/db";
import { apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
let count = 0;

async function variant(stock: number, { precioCentavos = 150000, tipo = "ESTANDAR" as "ESTANDAR" | "PERSONALIZABLE" } = {}) {
  count++;
  const category = await createCategory(actor, { nombre: `Categoría ${count}` });
  const product = await createProduct(actor, { nombre: `Producto ${count}`, categoriaId: category.id, tipo });
  const created = await createVariant(actor, product.id, tipo === "ESTANDAR" ? { precioCentavos } : {});
  if (stock > 0) await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: stock });
  return { id: created.id, productId: product.id };
}

async function client(email = "ana@ejemplo.com") {
  const response = await register(apiRequest("/api/auth/register", { body: { nombre: "Ana", email, contrasena: "clave-segura-1" } }));
  return sessionCookieFrom(response);
}

const add = (cookie: string | undefined, varianteId: string, cantidad: number) =>
  addItemRoute(apiRequest("/api/cart/items", { cookie, body: { varianteId, cantidad } }));
const cartOf = async (cookie: string) => (await (await getCartRoute(apiRequest("/api/cart", { method: "GET", cookie }))).json()) as CartView;
const patch = (cookie: string, itemId: string, cantidad: number) =>
  updateItemRoute(apiRequest(`/api/cart/items/${itemId}`, { method: "PATCH", cookie, body: { cantidad } }), params({ id: itemId }));

beforeEach(resetDatabase);
afterAll(async () => {
  await getDb().$disconnect();
});

describe("agregar al carrito (RF-12, RN-01)", () => {
  it("exige sesión", async () => {
    const { id } = await variant(5);
    expect((await add(undefined, id, 1)).status).toBe(401);
    expect((await getCartRoute(apiRequest("/api/cart", { method: "GET" }))).status).toBe(401);
  });

  it("rechaza un producto sin stock o más unidades que las disponibles (T-06)", async () => {
    const cookie = await client();
    const empty = await variant(0);
    const few = await variant(3);

    const noStock = await add(cookie, empty.id, 1);
    expect(noStock.status).toBe(409);
    expect((await noStock.json()).codigo).toBe("STOCK_INSUFICIENTE");

    const tooMany = await add(cookie, few.id, 4);
    expect(tooMany.status).toBe(409);
    expect((await tooMany.json()).detalles).toEqual({ disponible: 3 });
    expect((await cartOf(cookie)).items).toEqual([]);
  });

  it("suma las unidades de una misma variante, sin pasar del stock y sin retenerlo", async () => {
    const cookie = await client();
    const { id } = await variant(3);

    await add(cookie, id, 2);
    expect((await add(cookie, id, 2)).status).toBe(409);
    const cart = await (await add(cookie, id, 1)).json();

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ cantidad: 3, disponible: 3, advertencias: [] });
    expect(cart.subtotalCentavos).toBe(450000);
    expect((await getDb().variante.findUniqueOrThrow({ where: { id } })).stockReservado).toBe(0);
  });

  it("no admite personalizables, productos inactivos ni variantes inexistentes", async () => {
    const cookie = await client();
    const custom = await variant(0, { tipo: "PERSONALIZABLE" });
    const inactive = await variant(5);
    await updateProduct(actor, inactive.productId, { activo: false });

    expect((await (await add(cookie, custom.id, 1)).json()).codigo).toBe("PRODUCTO_PERSONALIZABLE");
    expect((await (await add(cookie, inactive.id, 1)).json()).codigo).toBe("PRODUCTO_NO_DISPONIBLE");
    expect((await add(cookie, crypto.randomUUID(), 1)).status).toBe(404);
  });
});

describe("modificar y quitar", () => {
  it("aumentar exige stock; reducir siempre se permite", async () => {
    const cookie = await client();
    const { id } = await variant(3);
    const [item] = (await (await add(cookie, id, 3)).json()).items;
    await registerVariantMovement(actor, id, { tipo: "AJUSTE", cantidad: -2, motivo: "Rotura" });

    expect((await patch(cookie, item.id, 4)).status).toBe(409);
    const reduced = await patch(cookie, item.id, 2);
    expect(reduced.status).toBe(200);
    expect((await reduced.json()).items[0]).toMatchObject({ cantidad: 2, advertencias: ["STOCK_INSUFICIENTE"] });
  });

  it("no permite tocar ítems del carrito de otro cliente", async () => {
    const ana = await client();
    const bruno = await client("bruno@ejemplo.com");
    const { id } = await variant(3);
    const [item] = (await (await add(ana, id, 1)).json()).items;

    expect((await patch(bruno, item.id, 2)).status).toBe(404);
    expect((await removeItemRoute(apiRequest(`/api/cart/items/${item.id}`, { method: "DELETE", cookie: bruno }), params({ id: item.id }))).status).toBe(404);

    const removed = await removeItemRoute(apiRequest(`/api/cart/items/${item.id}`, { method: "DELETE", cookie: ana }), params({ id: item.id }));
    expect((await removed.json()).items).toEqual([]);
  });
});

describe("advertencias (RF-13, RN-27)", () => {
  it("avisa sin stock y producto desactivado; lo desactivado no suma al subtotal (T-07)", async () => {
    const cookie = await client();
    const a = await variant(2);
    const b = await variant(2);
    await add(cookie, a.id, 2);
    await add(cookie, b.id, 1);

    await registerVariantMovement(actor, a.id, { tipo: "AJUSTE", cantidad: -2, motivo: "Rotura" });
    await updateVariant(actor, b.id, { activa: false });
    const cart = await cartOf(cookie);

    expect(cart.items.map((item) => item.advertencias)).toEqual([["SIN_STOCK"], ["NO_DISPONIBLE"]]);
    expect(cart.subtotalCentavos).toBe(300000);
    expect(cart.hayAdvertencias).toBe(true);
  });

  it("avisa un cambio de precio, calcula con el vigente y deja de avisar al aceptarlo (T-117)", async () => {
    const cookie = await client();
    const { id } = await variant(5, { precioCentavos: 100000 });
    await add(cookie, id, 2);
    await updateVariant(actor, id, { precioCentavos: 120000 });

    const changed = await cartOf(cookie);
    expect(changed.items[0]).toMatchObject({ precioUnitarioCentavos: 120000, precioAlAgregarCentavos: 100000, advertencias: ["PRECIO_CAMBIO"] });
    expect(changed.subtotalCentavos).toBe(240000);

    const accepted = await (await acceptPricesRoute(apiRequest("/api/cart/prices/accept", { cookie }))).json();
    expect(accepted.items[0].advertencias).toEqual([]);
  });
});

describe("carrito de visitante (RN-25)", () => {
  it("la vista previa calcula precios y advertencias sin sesión ni guardar nada", async () => {
    const { id } = await variant(2);
    const response = await previewRoute(
      apiRequest("/api/cart/preview", { body: { items: [{ varianteId: id, cantidad: 2 }, { varianteId: id, cantidad: 1 }, { varianteId: crypto.randomUUID(), cantidad: 1 }] } }),
    );
    const cart = await response.json();

    expect(response.status).toBe(200);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ id: null, cantidad: 3, advertencias: ["STOCK_INSUFICIENTE"] });
    expect(await getDb().carrito.count()).toBe(0);
  });

  it("al ingresar, suma al carrito existente, recorta a lo disponible y descarta lo que no se puede comprar (T-113)", async () => {
    const cookie = await client();
    const kept = await variant(5);
    const capped = await variant(2);
    const noStock = await variant(0);
    const custom = await variant(0, { tipo: "PERSONALIZABLE" });
    await add(cookie, kept.id, 1);

    const result = await (
      await mergeRoute(
        apiRequest("/api/cart/merge", {
          cookie,
          body: {
            items: [
              { varianteId: kept.id, cantidad: 2 },
              { varianteId: capped.id, cantidad: 5 },
              { varianteId: noStock.id, cantidad: 1 },
              { varianteId: custom.id, cantidad: 1 },
            ],
          },
        }),
      )
    ).json();

    expect(result.carrito.items.map((item: { varianteId: string; cantidad: number }) => [item.varianteId, item.cantidad])).toEqual([
      [kept.id, 3],
      [capped.id, 2],
    ]);
    expect(result.ajustados).toEqual([capped.id]);
    expect(result.descartados.sort()).toEqual([noStock.id, custom.id].sort());
  });
});
