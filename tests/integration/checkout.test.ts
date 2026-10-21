import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cashPaymentRoute } from "@/app/api/admin/orders/[id]/cash-payment/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { GET as getOrderRoute } from "@/app/api/orders/[id]/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant, updateVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { assertSimulatedPaymentsEnabled } from "@/server/modules/orders/order-payment.service";
import { reservationExpiry } from "@/server/modules/orders/reservation.policy";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();
let count = 0;

async function variant(stock: number, precioCentavos = 150000) {
  count++;
  const category = await createCategory(actor, { nombre: `Categoría ${count}` });
  const product = await createProduct(actor, { nombre: `Taza ${count}`, categoriaId: category.id, tipo: "ESTANDAR" });
  const created = await createVariant(actor, product.id, { material: "Cerámica", precioCentavos });
  if (stock > 0) await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: stock });
  return created.id;
}

async function client(email = "ana@ejemplo.com", telefono?: string) {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Ana", email, contrasena: "clave-segura-1", telefono } }),
  );
  const { usuario } = await response.json();
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

const addToCart = (cookie: string, varianteId: string, cantidad: number) =>
  addItemRoute(apiRequest("/api/cart/items", { cookie, body: { varianteId, cantidad } }));

type CheckoutBody = { modalidadCierre?: string; modalidadEntrega?: string; precios?: { varianteId: string; precioUnitarioCentavos: number }[] };

function checkout(cookie: string | undefined, body: CheckoutBody, key: string | null = crypto.randomUUID()) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: APP_URL };
  if (cookie) headers.cookie = cookie;
  if (key) headers["idempotency-key"] = key;
  return checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({ modalidadCierre: "ONLINE", modalidadEntrega: "RETIRO", ...body }),
    }),
  );
}

const pay = (cookie: string, orderId: string, resultado: string) =>
  payRoute(apiRequest(`/api/payments/simulated/${orderId}`, { cookie, body: { resultado } }), params({ orderId }));

async function placeOrder(cookie: string, varianteId: string, cantidad = 1, precioUnitarioCentavos = 150000, modalidadCierre = "ONLINE") {
  await addToCart(cookie, varianteId, cantidad);
  const response = await checkout(cookie, { modalidadCierre, precios: [{ varianteId, precioUnitarioCentavos }] });
  expect(response.status).toBe(201);
  return (await response.json()).pedido.id as string;
}

const minutesFromNow = (date: Date | null) => (date!.getTime() - Date.now()) / 60_000;

beforeEach(resetDatabase);
afterAll(async () => {
  await db().$disconnect();
});

describe("confirmación del pedido con retiro (RF-14 a RF-17)", () => {
  it("exige sesión, clave de idempotencia y un carrito con productos (T-08)", async () => {
    const ana = await client();
    expect((await checkout(undefined, { precios: [] })).status).toBe(401);
    expect((await (await checkout(ana.cookie, { precios: [] }, null)).json()).codigo).toBe("CLAVE_IDEMPOTENCIA_REQUERIDA");
    const empty = await checkout(ana.cookie, { precios: [] });
    expect(empty.status).toBe(422);
    expect((await empty.json()).codigo).toBe("CARRITO_VACIO");
  });

  it("crea el pedido con pago online: precios congelados, stock retenido, plazo de 30 min y carrito vacío", async () => {
    const ana = await client();
    const varianteId = await variant(5, 150000);
    const orderId = await placeOrder(ana.cookie, varianteId, 2);

    const order = await db().pedido.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, historial: true } });
    expect(order).toMatchObject({ estado: "PENDIENTE_PAGO", modalidadEntrega: "RETIRO", subtotalProductosCentavos: 300000, totalCentavos: 300000 });
    expect(order.items).toEqual([expect.objectContaining({ varianteId, cantidad: 2, precioUnitarioCentavos: 150000, descripcion: `Taza ${count} · Cerámica` })]);
    expect(minutesFromNow(order.venceEn)).toBeGreaterThan(29);
    expect(minutesFromNow(order.venceEn)).toBeLessThanOrEqual(30);
    expect(order.historial).toEqual([expect.objectContaining({ estadoAnterior: null, estadoNuevo: "PENDIENTE_PAGO" })]);

    expect(await db().retencionStock.findMany({ where: { pedidoId: orderId } })).toEqual([expect.objectContaining({ cantidad: 2, estado: "ACTIVA" })]);
    expect((await db().variante.findUniqueOrThrow({ where: { id: varianteId } })).stockReservado).toBe(2);
    expect(await db().itemCarrito.count()).toBe(0);
    expect(await db().notificacion.count({ where: { usuarioId: ana.id } })).toBe(1);
    expect(await db().salidaNotificacion.count({ where: { destinatario: "ana@ejemplo.com", estado: "PENDIENTE" } })).toBe(1);
    expect(await db().eventoAuditoria.count({ where: { accion: "PEDIDO_CREADO", entidadId: orderId } })).toBe(1);
  });

  it("si el precio cambió desde que el cliente lo vio, no crea el pedido y devuelve el vigente (T-118)", async () => {
    const ana = await client();
    const varianteId = await variant(5, 100000);
    await addToCart(ana.cookie, varianteId, 1);
    await updateVariant(actor, varianteId, { precioCentavos: 120000 });

    const response = await checkout(ana.cookie, { precios: [{ varianteId, precioUnitarioCentavos: 100000 }] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ codigo: "PRECIO_CAMBIADO", detalles: { precios: [{ varianteId, precioUnitarioCentavos: 120000 }] } });
    expect(await db().pedido.count()).toBe(0);
    expect(await db().retencionStock.count()).toBe(0);
    expect(await db().itemCarrito.count()).toBe(1);
  });

  it("revalida el stock al confirmar: sin stock no se crea el pedido (T-07)", async () => {
    const ana = await client();
    const varianteId = await variant(2);
    await addToCart(ana.cookie, varianteId, 2);
    await registerVariantMovement(actor, varianteId, { tipo: "AJUSTE", cantidad: -1, motivo: "Rotura" });

    const response = await checkout(ana.cookie, { precios: [{ varianteId, precioUnitarioCentavos: 150000 }] });
    expect(response.status).toBe(409);
    expect((await response.json()).codigo).toBe("STOCK_INSUFICIENTE");
    expect(await db().pedido.count()).toBe(0);
    expect(await db().itemCarrito.count()).toBe(1);
  });

  it("la misma clave, también en paralelo, crea un solo pedido (T-09)", async () => {
    const ana = await client();
    const varianteId = await variant(5);
    await addToCart(ana.cookie, varianteId, 1);
    const key = crypto.randomUUID();
    const body = { precios: [{ varianteId, precioUnitarioCentavos: 150000 }] };

    const responses = await Promise.all([1, 2, 3].map(() => checkout(ana.cookie, body, key)));
    const ids = await Promise.all(responses.map(async (response) => (await response.json()).pedido.id));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(ids).size).toBe(1);
    expect(await db().pedido.count()).toBe(1);
    expect((await db().variante.findUniqueOrThrow({ where: { id: varianteId } })).stockReservado).toBe(1);
    expect((await checkout(ana.cookie, body, key)).status).toBe(200);
  });

  it("dos clientes confirman a la vez por la última unidad: solo uno obtiene el pedido (RN-05)", async () => {
    const varianteId = await variant(1);
    const buyers = await Promise.all([client("ana@ejemplo.com"), client("bruno@ejemplo.com")]);
    for (const buyer of buyers) await addToCart(buyer.cookie, varianteId, 1);

    const responses = await Promise.all(
      buyers.map((buyer) => checkout(buyer.cookie, { precios: [{ varianteId, precioUnitarioCentavos: 150000 }] })),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await db().pedido.count()).toBe(1);
  });

  it("la reserva en efectivo exige teléfono y vence a las 24 h hábiles (RN-13, RN-18, RN-06, RN-29)", async () => {
    const withoutPhone = await client("sin@ejemplo.com");
    const withPhone = await client("con@ejemplo.com", "+54 11 5555-1234");
    const varianteId = await variant(5);
    await addToCart(withoutPhone.cookie, varianteId, 1);

    const rejected = await checkout(withoutPhone.cookie, { modalidadCierre: "EFECTIVO", precios: [{ varianteId, precioUnitarioCentavos: 150000 }] });
    expect((await rejected.json()).codigo).toBe("TELEFONO_REQUERIDO");

    const before = reservationExpiry(new Date(), new Set(), "America/Argentina/Buenos_Aires");
    const orderId = await placeOrder(withPhone.cookie, varianteId, 1, 150000, "EFECTIVO");
    const after = reservationExpiry(new Date(), new Set(), "America/Argentina/Buenos_Aires");
    const order = await db().pedido.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estado).toBe("RESERVADO");
    expect(order.venceEn!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(order.venceEn!.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe("pago online simulado (RF-46 a RF-48, RN-16)", () => {
  it("un rechazo queda registrado y el pedido sigue pendiente; la aprobación lo confirma", async () => {
    const ana = await client();
    const orderId = await placeOrder(ana.cookie, await variant(5));

    const rejected = await (await pay(ana.cookie, orderId, "RECHAZADO")).json();
    expect(rejected.confirmado).toBe(false);
    expect((await db().pedido.findUniqueOrThrow({ where: { id: orderId } })).estado).toBe("PENDIENTE_PAGO");

    const approved = await (await pay(ana.cookie, orderId, "APROBADO")).json();
    expect(approved.confirmado).toBe(true);
    const order = await db().pedido.findUniqueOrThrow({ where: { id: orderId }, include: { pagos: true, historial: true } });
    expect(order).toMatchObject({ estado: "CONFIRMADO", porcentajeCargoCancelacion: 15 });
    expect(order.pagos.map((payment) => [payment.estado, payment.simulado, payment.proveedor, payment.importeCentavos])).toEqual([
      ["RECHAZADO", true, "SIMULADO", 150000],
      ["APROBADO", true, "SIMULADO", 150000],
    ]);
    expect(order.historial.at(-1)).toMatchObject({ estadoAnterior: "PENDIENTE_PAGO", estadoNuevo: "CONFIRMADO" });
    expect(await db().notificacion.count({ where: { tipo: "PEDIDO_CONFIRMADO" } })).toBe(1);

    const again = await pay(ana.cookie, orderId, "APROBADO");
    expect(again.status).toBe(409);
    expect((await again.json()).codigo).toBe("PEDIDO_NO_PAGABLE");
  });

  it("dos aprobaciones simultáneas registran un solo pago aprobado", async () => {
    const ana = await client();
    const orderId = await placeOrder(ana.cookie, await variant(5));

    const statuses = await Promise.all([1, 2, 3].map(async () => (await pay(ana.cookie, orderId, "APROBADO")).status));

    expect(statuses.sort()).toEqual([201, 409, 409]);
    expect(await db().pago.count({ where: { pedidoId: orderId, estado: "APROBADO" } })).toBe(1);
  });

  it("rechaza el pago con el plazo vencido, aunque el proceso de vencimiento no haya corrido (T-104)", async () => {
    const ana = await client();
    const orderId = await placeOrder(ana.cookie, await variant(5));
    await db().pedido.update({ where: { id: orderId }, data: { venceEn: new Date(Date.now() - 1000) } });

    const response = await pay(ana.cookie, orderId, "APROBADO");
    expect(response.status).toBe(409);
    expect((await response.json()).codigo).toBe("PAGO_VENCIDO");
    expect(await db().pago.count()).toBe(0);
  });

  it("un cliente no ve ni paga pedidos de otro (T-40)", async () => {
    const ana = await client();
    const bruno = await client("bruno@ejemplo.com");
    const orderId = await placeOrder(ana.cookie, await variant(5));

    expect((await getOrderRoute(apiRequest(`/api/orders/${orderId}`, { method: "GET", cookie: bruno.cookie }), params({ id: orderId }))).status).toBe(404);
    expect((await pay(bruno.cookie, orderId, "APROBADO")).status).toBe(404);
  });

  it("el endpoint de pago simulado no existe si el modo simulado está desactivado (T-48)", () => {
    expect(() => assertSimulatedPaymentsEnabled("desactivado")).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => assertSimulatedPaymentsEnabled("simulado")).not.toThrow();
  });
});

describe("pago en efectivo de una reserva (RF-19)", () => {
  async function admin() {
    const account = await client("admin@tienda.ejemplo");
    await db().usuario.update({ where: { id: account.id }, data: { rol: "ADMIN" } });
    return account;
  }
  const registerCash = (cookie: string, orderId: string) =>
    cashPaymentRoute(apiRequest(`/api/admin/orders/${orderId}/cash-payment`, { cookie }), params({ id: orderId }));

  it("solo el admin lo registra; confirma la reserva y queda como pago real en efectivo (T-79)", async () => {
    const ana = await client("ana@ejemplo.com", "+54 11 5555-1234");
    const orderId = await placeOrder(ana.cookie, await variant(5), 1, 150000, "EFECTIVO");
    expect((await db().pedido.findUniqueOrThrow({ where: { id: orderId } })).estado).toBe("RESERVADO");

    expect((await registerCash(ana.cookie, orderId)).status).toBe(403);
    expect((await pay(ana.cookie, orderId, "APROBADO")).status).toBe(409);

    const owner = await admin();
    expect((await registerCash(owner.cookie, orderId)).status).toBe(201);
    const order = await db().pedido.findUniqueOrThrow({ where: { id: orderId }, include: { pagos: true } });
    expect(order.estado).toBe("CONFIRMADO");
    expect(order.pagos).toEqual([expect.objectContaining({ medio: "EFECTIVO", simulado: false, estado: "APROBADO", registradoPorId: owner.id })]);
  });

  it("no registra el efectivo de una reserva vencida (T-13)", async () => {
    const ana = await client("ana@ejemplo.com", "+54 11 5555-1234");
    const orderId = await placeOrder(ana.cookie, await variant(5), 1, 150000, "EFECTIVO");
    await db().pedido.update({ where: { id: orderId }, data: { venceEn: new Date(Date.now() - 1000) } });

    const response = await registerCash((await admin()).cookie, orderId);
    expect(response.status).toBe(409);
    expect((await response.json()).codigo).toBe("RESERVA_VENCIDA");
  });
});
