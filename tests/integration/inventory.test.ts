import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as variantMovementRoute } from "@/app/api/admin/variants/[id]/stock-movements/route";
import { POST as register } from "@/app/api/auth/register/route";
import { createCategory, createProduct, createVariant, updateProduct } from "@/server/modules/catalog/catalog-admin.service";
import { getProductBySlug } from "@/server/modules/catalog/catalog.service";
import {
  consumeRetention,
  releaseOrderRetentions,
  releaseRetention,
  reserveStock,
  type StockItem,
} from "@/server/modules/inventory/stock-retention.service";
import {
  createMaterial,
  reconcileStock,
  registerMaterialMovement,
  registerVariantMovement,
} from "@/server/modules/inventory/stock.service";
import { getDb } from "@/server/shared/db";
import { apiRequest, createTestOrder, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();

let productCount = 0;
async function variantWithStock(units: number, tipo: "ESTANDAR" | "PERSONALIZABLE" = "ESTANDAR") {
  productCount++;
  const category = await createCategory(actor, { nombre: `Categoría ${productCount}` });
  const product = await createProduct(actor, { nombre: `Producto ${productCount}`, categoriaId: category.id, tipo });
  const variant = await createVariant(actor, product.id, tipo === "ESTANDAR" ? { precioCentavos: 100000 } : {});
  if (units > 0) await registerVariantMovement(actor, variant.id, { tipo: "INGRESO", cantidad: units });
  return { variantId: variant.id, product };
}

async function reserve(items: StockItem[], pedidoId?: string) {
  const orderId = pedidoId ?? (await createTestOrder());
  return db().$transaction((tx) => reserveStock(tx, orderId, items));
}

async function stockOf(variantId: string) {
  const { stockFisico, stockReservado } = await db().variante.findUniqueOrThrow({ where: { id: variantId } });
  return { stockFisico, stockReservado };
}

const codes = (results: PromiseSettledResult<unknown>[]) =>
  results.flatMap((result) => (result.status === "rejected" ? [(result.reason as { code?: string }).code] : []));

beforeEach(resetDatabase);
afterAll(async () => {
  await db().$disconnect();
});

describe("retención concurrente (RN-01, RN-05)", () => {
  it("20 pedidos simultáneos por la última unidad: solo uno la obtiene (T-01)", async () => {
    const { variantId } = await variantWithStock(1);

    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserve([{ varianteId: variantId, cantidad: 1 }])));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(codes(results)).toEqual(Array(19).fill("STOCK_INSUFICIENTE"));
    expect(await stockOf(variantId)).toEqual({ stockFisico: 1, stockReservado: 1 });
    expect(await db().retencionStock.count({ where: { estado: "ACTIVA" } })).toBe(1);
    expect(await reconcileStock()).toEqual([]);
  });

  it("10 pedidos simultáneos de 2 unidades con stock 5: exactamente 2 se confirman (T-02)", async () => {
    const { variantId } = await variantWithStock(5);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserve([{ varianteId: variantId, cantidad: 2 }])));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(await stockOf(variantId)).toEqual({ stockFisico: 5, stockReservado: 4 });
  });

  it("si un ítem no tiene stock, no se retiene ninguno (T-03)", async () => {
    const a = await variantWithStock(3);
    const b = await variantWithStock(3);
    const c = await variantWithStock(0);

    await expect(
      reserve([{ varianteId: a.variantId, cantidad: 1 }, { varianteId: b.variantId, cantidad: 1 }, { varianteId: c.variantId, cantidad: 1 }]),
    ).rejects.toMatchObject({ code: "STOCK_INSUFICIENTE", details: { varianteId: c.variantId } });

    expect(await stockOf(a.variantId)).toEqual({ stockFisico: 3, stockReservado: 0 });
    expect(await stockOf(b.variantId)).toEqual({ stockFisico: 3, stockReservado: 0 });
    expect(await db().retencionStock.count()).toBe(0);
    expect(await db().movimientoStock.count({ where: { tipo: "RETENCION" } })).toBe(0);
  });

  it("pedidos simultáneos con las mismas variantes en distinto orden no se bloquean (T-04)", async () => {
    const a = await variantWithStock(50);
    const b = await variantWithStock(50);
    const forward = [{ varianteId: a.variantId, cantidad: 1 }, { varianteId: b.variantId, cantidad: 1 }];
    const backward = [...forward].reverse();

    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => reserve(index % 2 ? forward : backward)));

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await stockOf(a.variantId)).toEqual({ stockFisico: 50, stockReservado: 20 });
    expect(await stockOf(b.variantId)).toEqual({ stockFisico: 50, stockReservado: 20 });
  });

  it("suma los ítems repetidos de una misma variante", async () => {
    const { variantId } = await variantWithStock(5);
    const [retention] = await reserve([{ varianteId: variantId, cantidad: 1 }, { varianteId: variantId, cantidad: 2 }]);

    expect(retention?.cantidad).toBe(3);
    expect(await stockOf(variantId)).toEqual({ stockFisico: 5, stockReservado: 3 });
  });

  it("no retiene variantes ni productos inactivos", async () => {
    const { variantId, product } = await variantWithStock(5);
    await updateProduct(actor, product.id, { activo: false });

    await expect(reserve([{ varianteId: variantId, cantidad: 1 }])).rejects.toMatchObject({ code: "STOCK_INSUFICIENTE" });
  });
});

describe("liberación y consumo (RN-06, sección 14.6)", () => {
  it("liberar dos veces, también en paralelo, devuelve las unidades una sola vez", async () => {
    const { variantId } = await variantWithStock(3);
    const [retention] = await reserve([{ varianteId: variantId, cantidad: 2 }]);

    const results = await Promise.all(
      [1, 2, 3].map(() => db().$transaction((tx) => releaseRetention(tx, retention!.id, "VENCIMIENTO_RESERVA"))),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await stockOf(variantId)).toEqual({ stockFisico: 3, stockReservado: 0 });
    expect(await db().movimientoStock.count({ where: { tipo: "LIBERACION" } })).toBe(1);
    expect(await db().retencionStock.findUniqueOrThrow({ where: { id: retention!.id } })).toMatchObject({
      estado: "LIBERADA",
      motivoLiberacion: "VENCIMIENTO_RESERVA",
    });
  });

  it("consumir descuenta del físico y del reservado; después no se puede liberar", async () => {
    const { variantId } = await variantWithStock(5);
    const [retention] = await reserve([{ varianteId: variantId, cantidad: 2 }]);

    expect(await db().$transaction((tx) => consumeRetention(tx, retention!.id))).toBe(true);
    expect(await db().$transaction((tx) => releaseRetention(tx, retention!.id, "CANCELACION"))).toBe(false);
    expect(await stockOf(variantId)).toEqual({ stockFisico: 3, stockReservado: 0 });
    expect(await reconcileStock()).toEqual([]);
  });

  it("libera todas las retenciones activas de un pedido", async () => {
    const a = await variantWithStock(5);
    const b = await variantWithStock(5);
    const pedidoId = await createTestOrder();
    await reserve([{ varianteId: a.variantId, cantidad: 2 }, { varianteId: b.variantId, cantidad: 1 }], pedidoId);

    expect(await db().$transaction((tx) => releaseOrderRetentions(tx, pedidoId, "CANCELACION"))).toBe(2);
    expect(await db().$transaction((tx) => releaseOrderRetentions(tx, pedidoId, "CANCELACION"))).toBe(0);
    expect(await stockOf(a.variantId)).toEqual({ stockFisico: 5, stockReservado: 0 });
  });
});

describe("ingresos y ajustes (RF-08, T-05)", () => {
  it("no deja el stock físico por debajo de lo reservado", async () => {
    const { variantId } = await variantWithStock(5);
    await reserve([{ varianteId: variantId, cantidad: 3 }]);

    await expect(registerVariantMovement(actor, variantId, { tipo: "AJUSTE", cantidad: -3, motivo: "Rotura" })).rejects.toMatchObject({
      code: "AJUSTE_INVALIDO",
      status: 409,
    });
    await registerVariantMovement(actor, variantId, { tipo: "AJUSTE", cantidad: -2, motivo: "Rotura" });
    expect(await stockOf(variantId)).toEqual({ stockFisico: 3, stockReservado: 3 });
  });

  it("dos ajustes simultáneos no dejan el stock negativo", async () => {
    const { variantId } = await variantWithStock(3);

    const results = await Promise.allSettled(
      [1, 2].map(() => registerVariantMovement(actor, variantId, { tipo: "AJUSTE", cantidad: -2, motivo: "Conteo" })),
    );

    expect(codes(results)).toEqual(["AJUSTE_INVALIDO"]);
    expect(await stockOf(variantId)).toEqual({ stockFisico: 1, stockReservado: 0 });
  });

  it("valida el movimiento: el ingreso es positivo y el ajuste exige motivo", async () => {
    const { variantId } = await variantWithStock(0);
    await expect(registerVariantMovement(actor, variantId, { tipo: "INGRESO", cantidad: 0 })).rejects.toThrow();
    await expect(registerVariantMovement(actor, variantId, { tipo: "AJUSTE", cantidad: 2 })).rejects.toThrow();
    expect(await db().movimientoStock.count()).toBe(0);
  });

  it("la base rechaza un stock inválido aunque el código fallara", async () => {
    const { variantId } = await variantWithStock(2);
    await expect(
      db().$executeRaw`UPDATE variante SET stock_reservado = stock_fisico + 1 WHERE id = ${variantId}::uuid`,
    ).rejects.toThrow(/variante_stock_reservado_valido/);
  });

  it("el endpoint exige rol de administrador y registra quién hizo el movimiento", async () => {
    const { variantId } = await variantWithStock(0);
    const response = await register(apiRequest("/api/auth/register", { body: { nombre: "Admin", email: "admin@tienda.ejemplo", contrasena: "clave-segura-1" } }));
    const cookie = sessionCookieFrom(response);
    const call = () =>
      variantMovementRoute(
        apiRequest(`/api/admin/variants/${variantId}/stock-movements`, { cookie, body: { tipo: "INGRESO", cantidad: 4, motivo: "Compra" } }),
        params({ id: variantId }),
      );

    expect((await call()).status).toBe(403);
    const { usuario } = await response.json();
    await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
    expect((await call()).status).toBe(201);
    expect(await db().movimientoStock.findFirstOrThrow()).toMatchObject({ tipo: "INGRESO", deltaFisico: 4, motivo: "Compra", autorId: usuario.id });
  });
});

describe("materiales (RF-09)", () => {
  it("registra ingresos y ajustes sin quedar en negativo", async () => {
    const material = await createMaterial(actor, { nombre: "Vinilo blanco", unidad: "cm²", umbralStockBajo: 1000 });
    await registerMaterialMovement(actor, material.id, { tipo: "INGRESO", cantidad: 8100 });

    await expect(registerMaterialMovement(actor, material.id, { tipo: "AJUSTE", cantidad: -9000, motivo: "Conteo" })).rejects.toMatchObject({
      code: "AJUSTE_INVALIDO",
    });
    expect((await db().material.findUniqueOrThrow({ where: { id: material.id } })).stockFisico).toBe(8100);
  });
});

describe("conciliación (sección 14.8, T-51)", () => {
  it("detecta un stock que no coincide con los movimientos", async () => {
    const { variantId } = await variantWithStock(4);
    await reserve([{ varianteId: variantId, cantidad: 1 }]);
    expect(await reconcileStock()).toEqual([]);

    await db().$executeRaw`UPDATE variante SET stock_fisico = stock_fisico + 1 WHERE id = ${variantId}::uuid`;

    expect(await reconcileStock()).toEqual([
      expect.objectContaining({ id: variantId, stockFisico: 5, fisicoSegunMovimientos: 4, reservadoSegunRetenciones: 1 }),
    ]);
  });
});

describe("disponibilidad en el catálogo (RF-06)", () => {
  it("publica lo disponible de los estándar y no de los personalizables", async () => {
    const standard = await variantWithStock(2);
    const custom = await variantWithStock(0, "PERSONALIZABLE");

    expect((await getProductBySlug(standard.product.slug)).variantes[0]?.disponible).toBe(2);
    await reserve([{ varianteId: standard.variantId, cantidad: 2 }]);
    const exhausted = await getProductBySlug(standard.product.slug);
    expect(exhausted.variantes[0]?.disponible).toBe(0);
    expect(exhausted.hayStock).toBe(false);

    const customDetail = await getProductBySlug(custom.product.slug);
    expect(customDetail.variantes[0]?.disponible).toBeNull();
    expect(customDetail.hayStock).toBeNull();
  });
});
