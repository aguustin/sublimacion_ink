import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as quoteRoute } from "@/app/api/admin/orders/[id]/shipping-quote/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { POST as cronRoute } from "@/app/api/internal/jobs/expire-shipping-quotes/route";
import { POST as acceptRoute } from "@/app/api/orders/[id]/shipping/accept/route";
import { POST as declineRoute } from "@/app/api/orders/[id]/shipping/decline/route";
import { POST as pickupRoute } from "@/app/api/orders/[id]/shipping/pickup/route";
import { GET as viewRoute } from "@/app/api/orders/[id]/shipping/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant, updateVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { expireCashReservations, expireOnlinePayments, expireShippingQuotes } from "@/server/modules/orders/expiration.service";
import { reservationExpiry } from "@/server/modules/orders/reservation.policy";
import { createAddress } from "@/server/modules/users/profile.service";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();
const HOUR = 3_600_000;
const TZ = "America/Argentina/Buenos_Aires";

type Account = { id: string; cookie: string };

async function account(email: string, { admin = false } = {}): Promise<Account> {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1", telefono: "1155551234" } }),
  );
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

async function variant(stock: number, precioCentavos = 150000) {
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const created = await createVariant(actor, product.id, { precioCentavos });
  await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: stock });
  return created.id;
}

const address = (usuarioId: string) =>
  createAddress(usuarioId, { calle: "Av. Siempre Viva 742", ciudad: "Rosario", provincia: "Santa Fe", codigoPostal: "2000" }).then((a) => a.id);

function checkout(cookie: string, body: Record<string, unknown>) {
  return checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
  );
}

/** Pedido con envío esperando la cotización (F-10). */
async function shippingOrder(user: Account, varianteId: string, precio = 150000) {
  await addItemRoute(apiRequest("/api/cart/items", { cookie: user.cookie, body: { varianteId, cantidad: 1 } }));
  const response = await checkout(user.cookie, {
    modalidadCierre: "ONLINE",
    modalidadEntrega: "ENVIO",
    direccionId: await address(user.id),
    precios: [{ varianteId, precioUnitarioCentavos: precio }],
  });
  expect(response.status).toBe(201);
  return (await response.json()).pedido.id as string;
}

const quote = (cookie: string, id: string, body: unknown) =>
  quoteRoute(apiRequest(`/api/admin/orders/${id}/shipping-quote`, { cookie, body }), params({ id }));
const accept = (cookie: string, id: string, body: unknown) =>
  acceptRoute(apiRequest(`/api/orders/${id}/shipping/accept`, { cookie, body }), params({ id }));
const pickup = (cookie: string, id: string, body: unknown) =>
  pickupRoute(apiRequest(`/api/orders/${id}/shipping/pickup`, { cookie, body }), params({ id }));
const decline = (cookie: string, id: string) => declineRoute(apiRequest(`/api/orders/${id}/shipping/decline`, { cookie }), params({ id }));
const view = async (cookie: string, id: string) =>
  (await viewRoute(apiRequest(`/api/orders/${id}/shipping`, { method: "GET", cookie }), params({ id }))).json();
const orderOf = (id: string) => db().pedido.findUniqueOrThrow({ where: { id }, include: { items: true, retenciones: true, historial: true } });
const reservedOf = async (id: string) => (await db().variante.findUniqueOrThrow({ where: { id } })).stockReservado;

let admin: Account;
let ana: Account;

beforeEach(async () => {
  await resetDatabase();
  admin = await account("admin@tienda.ejemplo", { admin: true });
  ana = await account("ana@ejemplo.com");
});
afterAll(async () => {
  await db().$disconnect();
});

describe("checkout con envío (F-10, D-45)", () => {
  it("crea el pedido esperando la cotización, sin retener stock, con la dirección copiada y 48 h para cotizar", async () => {
    const varianteId = await variant(3);
    const before = Date.now();
    const id = await shippingOrder(ana, varianteId);

    const order = await orderOf(id);
    expect(order).toMatchObject({ estado: "ENVIO_A_COTIZAR", modalidadEntrega: "ENVIO", costoEnvioCentavos: 0, totalCentavos: 150000 });
    expect(order.direccionEnvio).toMatchObject({ calle: "Av. Siempre Viva 742", codigoPostal: "2000" });
    expect(order.venceEn!.getTime() - before).toBeGreaterThanOrEqual(48 * HOUR);
    expect(order.venceEn!.getTime() - Date.now()).toBeLessThanOrEqual(48 * HOUR);
    expect(order.retenciones).toHaveLength(0);
    expect(await reservedOf(varianteId)).toBe(0);
    expect(await db().itemCarrito.count()).toBe(0);
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "ENVIO_A_COTIZAR" } })).toBe(1);
  });

  it("exige pago online, una dirección propia y stock disponible hoy", async () => {
    const varianteId = await variant(1);
    await addItemRoute(apiRequest("/api/cart/items", { cookie: ana.cookie, body: { varianteId, cantidad: 1 } }));
    const precios = [{ varianteId, precioUnitarioCentavos: 150000 }];
    const direccionId = await address(ana.id);

    const cash = await checkout(ana.cookie, { modalidadCierre: "EFECTIVO", modalidadEntrega: "ENVIO", direccionId, precios });
    expect(await cash.json()).toMatchObject({ codigo: "EFECTIVO_SOLO_RETIRO" });
    const noAddress = await checkout(ana.cookie, { modalidadCierre: "ONLINE", modalidadEntrega: "ENVIO", precios });
    expect(noAddress.status).toBe(422);

    const bruno = await account("bruno@ejemplo.com");
    const foreign = await checkout(ana.cookie, {
      modalidadCierre: "ONLINE",
      modalidadEntrega: "ENVIO",
      direccionId: await address(bruno.id),
      precios,
    });
    expect(foreign.status).toBe(404);

    await registerVariantMovement(actor, varianteId, { tipo: "AJUSTE", cantidad: -1, motivo: "Rotura" });
    const noStock = await checkout(ana.cookie, { modalidadCierre: "ONLINE", modalidadEntrega: "ENVIO", direccionId, precios });
    expect(await noStock.json()).toMatchObject({ codigo: "STOCK_INSUFICIENTE" });
    expect(await db().pedido.count()).toBe(0);
  });
});

describe("cotización del envío por la tienda", () => {
  it("solo el admin cotiza; el pedido pasa a cotizado con 48 h para responder y se avisa al cliente", async () => {
    const id = await shippingOrder(ana, await variant(3));
    expect((await quote(ana.cookie, id, { envioPosible: true, importeCentavos: 20000 })).status).toBe(403);

    expect((await quote(admin.cookie, id, { envioPosible: true, importeCentavos: 20000, nota: "Correo" })).status).toBe(201);

    const order = await orderOf(id);
    expect(order.estado).toBe("ENVIO_COTIZADO");
    expect(order.venceEn!.getTime() - Date.now()).toBeGreaterThan(47.9 * HOUR);
    expect(order.historial.map((entry) => entry.estadoNuevo)).toEqual(expect.arrayContaining(["ENVIO_A_COTIZAR", "ENVIO_COTIZADO"]));
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "ENVIO_COTIZADO" } })).toBe(1);
    expect(await db().eventoAuditoria.count({ where: { accion: "ENVIO_COTIZADO", entidadId: id } })).toBe(1);
    expect(await view(ana.cookie, id)).toMatchObject({
      subtotalProductosCentavos: 150000,
      costoEnvioCentavos: 20000,
      totalCentavos: 170000,
      hayStock: true,
    });
  });

  it("una corrección reemplaza la cotización: aceptar la anterior se rechaza", async () => {
    const id = await shippingOrder(ana, await variant(3));
    const first = (await (await quote(admin.cookie, id, { envioPosible: true, importeCentavos: 20000 })).json()).cotizacion.id;
    await quote(admin.cookie, id, { envioPosible: true, importeCentavos: 25000 });

    const stale = await accept(ana.cookie, id, { cotizacionId: first, totalEsperadoCentavos: 170000 });
    expect(await stale.json()).toMatchObject({ codigo: "COTIZACION_DESACTUALIZADA" });
    expect(await db().cotizacionEnvio.findUniqueOrThrow({ where: { id: first } })).toMatchObject({ estado: "REEMPLAZADA" });
    expect((await orderOf(id)).estado).toBe("ENVIO_COTIZADO");
  });
});

describe("respuesta del cliente (D-45, D-47)", () => {
  it("acepta: retiene el stock, suma el envío y el pago online confirma el pedido por el total", async () => {
    const varianteId = await variant(3);
    const id = await shippingOrder(ana, varianteId);
    const cotizacionId = (await (await quote(admin.cookie, id, { envioPosible: true, importeCentavos: 20000 })).json()).cotizacion.id;
    const bruno = await account("bruno@ejemplo.com");
    expect((await accept(bruno.cookie, id, { cotizacionId, totalEsperadoCentavos: 170000 })).status).toBe(404);

    expect((await accept(ana.cookie, id, { cotizacionId, totalEsperadoCentavos: 170000 })).status).toBe(200);

    const order = await orderOf(id);
    expect(order).toMatchObject({ estado: "PENDIENTE_PAGO", modalidadEntrega: "ENVIO", costoEnvioCentavos: 20000, totalCentavos: 170000 });
    expect(order.retenciones).toEqual([expect.objectContaining({ estado: "ACTIVA", cantidad: 1 })]);
    expect(await reservedOf(varianteId)).toBe(1);
    expect(await db().cotizacionEnvio.findUniqueOrThrow({ where: { id: cotizacionId } })).toMatchObject({ estado: "ACEPTADA" });

    const paid = await payRoute(
      apiRequest(`/api/payments/simulated/${id}`, { cookie: ana.cookie, body: { resultado: "APROBADO" } }),
      params({ orderId: id }),
    );
    expect(paid.status).toBe(201);
    expect(await db().pago.findFirstOrThrow({ where: { pedidoId: id } })).toMatchObject({ importeCentavos: 170000 });
    expect((await orderOf(id)).estado).toBe("CONFIRMADO");
  });

  it("revalida precios al aceptar: con el total viejo se rechaza; con el nuevo, se cobra el precio vigente (RN-27)", async () => {
    const varianteId = await variant(3, 150000);
    const id = await shippingOrder(ana, varianteId);
    const cotizacionId = (await (await quote(admin.cookie, id, { envioPosible: true, importeCentavos: 20000 })).json()).cotizacion.id;
    await updateVariant(actor, varianteId, { precioCentavos: 160000 });

    const stale = await accept(ana.cookie, id, { cotizacionId, totalEsperadoCentavos: 170000 });
    expect(await stale.json()).toMatchObject({ codigo: "PRECIO_CAMBIADO", detalles: { totalCentavos: 180000 } });
    expect(await reservedOf(varianteId)).toBe(0);

    expect((await accept(ana.cookie, id, { cotizacionId, totalEsperadoCentavos: 180000 })).status).toBe(200);
    const order = await orderOf(id);
    expect(order).toMatchObject({ subtotalProductosCentavos: 160000, totalCentavos: 180000 });
    expect(order.items[0]?.precioUnitarioCentavos).toBe(160000);
  });

  it("sin stock al aceptar no cambia nada; compitiendo por la última unidad, solo uno la obtiene (RN-05)", async () => {
    const varianteId = await variant(1);
    const id = await shippingOrder(ana, varianteId);
    const cotizacionId = (await (await quote(admin.cookie, id, { envioPosible: true, importeCentavos: 20000 })).json()).cotizacion.id;
    const bruno = await account("bruno@ejemplo.com");
    await addItemRoute(apiRequest("/api/cart/items", { cookie: bruno.cookie, body: { varianteId, cantidad: 1 } }));

    const [accepted, purchase] = await Promise.all([
      accept(ana.cookie, id, { cotizacionId, totalEsperadoCentavos: 170000 }),
      checkout(bruno.cookie, { modalidadCierre: "ONLINE", modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: 150000 }] }),
    ]);
    expect([accepted.ok, purchase.ok].filter(Boolean)).toHaveLength(1);
    expect(await reservedOf(varianteId)).toBe(1);

    if (!accepted.ok) {
      expect(await accepted.json()).toMatchObject({ codigo: "STOCK_INSUFICIENTE" });
      expect((await orderOf(id)).estado).toBe("ENVIO_COTIZADO");
      expect(await db().cotizacionEnvio.findUniqueOrThrow({ where: { id: cotizacionId } })).toMatchObject({ estado: "PROPUESTA" });
    }
  });

  it("pasa a retiro con efectivo: reserva de 24 h hábiles sin envío; sin teléfono no puede elegir efectivo", async () => {
    const varianteId = await variant(3);
    const id = await shippingOrder(ana, varianteId);
    const cotizacionId = (await (await quote(admin.cookie, id, { envioPosible: true, importeCentavos: 20000 })).json()).cotizacion.id;

    const start = new Date();
    expect((await pickup(ana.cookie, id, { modalidadCierre: "EFECTIVO", totalEsperadoCentavos: 150000 })).status).toBe(200);
    const end = new Date();

    const order = await orderOf(id);
    expect(order).toMatchObject({
      estado: "RESERVADO",
      modalidadEntrega: "RETIRO",
      modalidadCierre: "EFECTIVO",
      costoEnvioCentavos: 0,
      totalCentavos: 150000,
    });
    expect(order.venceEn!.getTime()).toBeGreaterThanOrEqual(reservationExpiry(start, new Set(), TZ).getTime());
    expect(order.venceEn!.getTime()).toBeLessThanOrEqual(reservationExpiry(end, new Set(), TZ).getTime());
    expect(await reservedOf(varianteId)).toBe(1);
    expect(await db().cotizacionEnvio.findUniqueOrThrow({ where: { id: cotizacionId } })).toMatchObject({ estado: "RECHAZADA" });

    const carla = await account("carla@ejemplo.com");
    await db().usuario.update({ where: { id: carla.id }, data: { telefono: null } });
    const other = await shippingOrder(carla, varianteId);
    await quote(admin.cookie, other, { envioPosible: true, importeCentavos: 20000 });
    expect(await (await pickup(carla.cookie, other, { modalidadCierre: "EFECTIVO", totalEsperadoCentavos: 150000 })).json()).toMatchObject({
      codigo: "TELEFONO_REQUERIDO",
    });
    expect((await pickup(carla.cookie, other, { modalidadCierre: "ONLINE", totalEsperadoCentavos: 150000 })).status).toBe(200);
    expect((await orderOf(other)).estado).toBe("PENDIENTE_PAGO");
  });

  it("rechaza el costo: cancela sin cargo, como cancelación del cliente", async () => {
    const id = await shippingOrder(ana, await variant(3));
    await quote(admin.cookie, id, { envioPosible: true, importeCentavos: 20000 });

    expect((await decline(ana.cookie, id)).status).toBe(200);

    const order = await orderOf(id);
    expect(order.estado).toBe("CANCELADO");
    expect(order.historial.find((entry) => entry.estadoNuevo === "CANCELADO")).toMatchObject({ motivo: "COSTO_ENVIO_RECHAZADO", actorId: ana.id });
    const audit = await db().eventoAuditoria.findFirstOrThrow({ where: { accion: "PEDIDO_CANCELADO", entidadId: id } });
    expect(audit.datos).toMatchObject({ rol: "CLIENTE", cargoCentavos: 0, cuponEmitidoId: null });
    expect(await db().cancelacion.findUniqueOrThrow({ where: { pedidoId: id } })).toMatchObject({ rol: "CLIENTE", regla: "SIN_CARGO", cargoCentavos: 0 });
  });
});

describe("la tienda no puede enviar (D-49)", () => {
  it("si el cliente cancela, cuenta como cancelación de la tienda con cupón pendiente del módulo de cupones", async () => {
    const id = await shippingOrder(ana, await variant(3));
    const cotizacionId = (await (await quote(admin.cookie, id, { envioPosible: false, nota: "Zona sin cobertura" })).json()).cotizacion.id;
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "ENVIO_NO_POSIBLE" } })).toBe(1);

    expect(await (await accept(ana.cookie, id, { cotizacionId, totalEsperadoCentavos: 150000 })).json()).toMatchObject({
      codigo: "ENVIO_NO_POSIBLE",
    });
    expect((await decline(ana.cookie, id)).status).toBe(200);

    expect((await orderOf(id)).historial.find((entry) => entry.estadoNuevo === "CANCELADO")).toMatchObject({ motivo: "ENVIO_NO_POSIBLE" });
    const audit = await db().eventoAuditoria.findFirstOrThrow({ where: { accion: "PEDIDO_CANCELADO", entidadId: id } });
    expect(audit.datos).toMatchObject({ rol: "TIENDA", cuponEmitidoId: expect.any(String) });
    expect(await db().cupon.findUniqueOrThrow({ where: { pedidoOrigenId: id } })).toMatchObject({ montoCentavos: 15000 });
    expect(await db().cancelacion.findUniqueOrThrow({ where: { pedidoId: id } })).toMatchObject({ rol: "TIENDA", regla: "RN_19" });
  });

  it("si el cliente pasa a retiro, el pedido sigue y no corresponde cupón", async () => {
    const id = await shippingOrder(ana, await variant(3));
    await quote(admin.cookie, id, { envioPosible: false, nota: "Zona sin cobertura" });

    expect((await pickup(ana.cookie, id, { modalidadCierre: "ONLINE", totalEsperadoCentavos: 150000 })).status).toBe(200);

    expect((await orderOf(id)).estado).toBe("PENDIENTE_PAGO");
    expect(await db().eventoAuditoria.count({ where: { accion: "PEDIDO_CANCELADO", entidadId: id } })).toBe(0);
  });
});

describe("plazos de 48 h (D-46)", () => {
  it("sin cotización o sin respuesta a tiempo, el proceso cancela el pedido, sin cupón; los otros procesos no lo tocan", async () => {
    const unquoted = await shippingOrder(ana, await variant(3));
    const unanswered = await shippingOrder(ana, await variant(3));
    await quote(admin.cookie, unanswered, { envioPosible: true, importeCentavos: 20000 });
    const past = new Date(Date.now() - 1000);
    await db().pedido.updateMany({ where: { id: { in: [unquoted, unanswered] } }, data: { venceEn: past } });

    await expireOnlinePayments();
    await expireCashReservations();
    expect((await orderOf(unquoted)).estado).toBe("ENVIO_A_COTIZAR");

    // Actuar después del plazo se rechaza aunque el proceso todavía no haya corrido.
    expect(await (await quote(admin.cookie, unquoted, { envioPosible: true, importeCentavos: 1 })).json()).toMatchObject({ codigo: "PLAZO_VENCIDO" });
    expect(await (await decline(ana.cookie, unanswered)).json()).toMatchObject({ codigo: "PLAZO_VENCIDO" });

    expect(await expireShippingQuotes()).toEqual({ revisados: 2, vencidos: 2 });
    expect((await orderOf(unquoted)).historial.find((entry) => entry.estadoNuevo === "CANCELADO")).toMatchObject({
      motivo: "PLAZO_COTIZACION_ENVIO",
    });
    expect((await orderOf(unanswered)).historial.find((entry) => entry.estadoNuevo === "CANCELADO")).toMatchObject({
      motivo: "PLAZO_RESPUESTA_ENVIO",
    });
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "PEDIDO_CANCELADO" } })).toBe(2);
    expect(await expireShippingQuotes()).toEqual({ revisados: 0, vencidos: 0 });
  });

  it("el endpoint del cron exige el secreto", async () => {
    const response = await cronRoute(new Request(`${APP_URL}/api/internal/jobs/expire-shipping-quotes`, { method: "POST" }));
    expect(response.status).toBe(401);
  });
});
