import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteAddressRoute, PATCH as updateAddressRoute } from "@/app/api/account/addresses/[id]/route";
import { POST as createAddressRoute } from "@/app/api/account/addresses/route";
import { PATCH as profileRoute } from "@/app/api/account/profile/route";
import { PUT as dispatchDateRoute } from "@/app/api/admin/orders/[id]/dispatch-date/route";
import { PUT as storeSettingsRoute } from "@/app/api/admin/store-settings/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as mergeRoute } from "@/app/api/cart/merge/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();
const HOUR = 60 * 60 * 1000;

async function account(email: string, { admin = false, telefono }: { admin?: boolean; telefono?: string } = {}) {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1", telefono } }),
  );
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

async function variant(stock: number) {
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const created = await createVariant(actor, product.id, { precioCentavos: 150000 });
  await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: stock });
  return created.id;
}

function checkout(cookie: string, varianteId: string, modalidadCierre = "ONLINE") {
  return checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ modalidadCierre, modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: 150000 }] }),
    }),
  );
}

/** Pedido confirmado (pagado), que es donde el admin confirma la fecha. */
async function confirmedOrder(clientCookie: string) {
  const varianteId = await variant(5);
  await mergeRoute(apiRequest("/api/cart/merge", { cookie: clientCookie, body: { items: [{ varianteId, cantidad: 1 }] } }));
  const { pedido } = await (await checkout(clientCookie, varianteId)).json();
  await db().pedido.update({ where: { id: pedido.id }, data: { estado: "CONFIRMADO" } });
  return pedido.id as string;
}

const setDate = (cookie: string, orderId: string, fecha: Date, motivo?: string) =>
  dispatchDateRoute(
    apiRequest(`/api/admin/orders/${orderId}/dispatch-date`, { method: "PUT", cookie, body: { fecha: fecha.toISOString(), motivo } }),
    params({ id: orderId }),
  );

beforeEach(resetDatabase);
afterAll(async () => {
  await db().$disconnect();
});

describe("perfil del cliente (RF-03)", () => {
  it("edita nombre y teléfono; con teléfono ya puede reservar en efectivo", async () => {
    const ana = await account("ana@ejemplo.com");
    const varianteId = await variant(5);
    await mergeRoute(apiRequest("/api/cart/merge", { cookie: ana.cookie, body: { items: [{ varianteId, cantidad: 1 }] } }));
    expect((await (await checkout(ana.cookie, varianteId, "EFECTIVO")).json()).codigo).toBe("TELEFONO_REQUERIDO");

    const response = await profileRoute(
      apiRequest("/api/account/profile", { method: "PATCH", cookie: ana.cookie, body: { nombre: "Ana María", telefono: "+54 11 5555-1234" } }),
    );
    expect((await response.json()).usuario).toEqual({ nombre: "Ana María", telefono: "+54 11 5555-1234" });
    expect((await checkout(ana.cookie, varianteId, "EFECTIVO")).status).toBe(201);
  });

  it("valida el teléfono y permite borrarlo", async () => {
    const ana = await account("ana@ejemplo.com", { telefono: "1155551234" });
    const patch = (body: unknown) => profileRoute(apiRequest("/api/account/profile", { method: "PATCH", cookie: ana.cookie, body }));

    expect((await patch({ telefono: "llamame" })).status).toBe(422);
    expect((await (await patch({ telefono: "" })).json()).usuario.telefono).toBeNull();
  });

  it("gestiona direcciones propias; las de otro cliente dan 404", async () => {
    const ana = await account("ana@ejemplo.com");
    const bruno = await account("bruno@ejemplo.com");
    const address = { calle: "Av. Corrientes 1234", ciudad: "CABA", provincia: "Buenos Aires", codigoPostal: "c1043aab" };

    const created = await createAddressRoute(apiRequest("/api/account/addresses", { cookie: ana.cookie, body: address }));
    const { direccion } = await created.json();
    expect(direccion).toMatchObject({ codigoPostal: "C1043AAB", referencias: null });
    expect((await createAddressRoute(apiRequest("/api/account/addresses", { cookie: ana.cookie, body: { ...address, codigoPostal: "xx" } }))).status).toBe(422);

    const update = (cookie: string) =>
      updateAddressRoute(apiRequest(`/api/account/addresses/${direccion.id}`, { method: "PATCH", cookie, body: { referencias: "Timbre 3B" } }), params({ id: direccion.id }));
    expect((await update(bruno.cookie)).status).toBe(404);
    expect((await (await update(ana.cookie)).json()).direccion.referencias).toBe("Timbre 3B");

    const remove = (cookie: string) =>
      deleteAddressRoute(apiRequest(`/api/account/addresses/${direccion.id}`, { method: "DELETE", cookie }), params({ id: direccion.id }));
    expect((await remove(bruno.cookie)).status).toBe(404);
    expect((await remove(ana.cookie)).status).toBe(204);
    expect(await db().direccion.count()).toBe(0);
  });
});

describe("contacto de la tienda (RF-49)", () => {
  it("solo el admin lo configura; aparece en el aviso de una reserva en efectivo", async () => {
    const ana = await account("ana@ejemplo.com", { telefono: "1155551234" });
    const admin = await account("admin@tienda.ejemplo", { admin: true });
    const save = (cookie: string, body: unknown) => storeSettingsRoute(apiRequest("/api/admin/store-settings", { method: "PUT", cookie, body }));

    expect((await save(ana.cookie, { emailContacto: "x@y.com" })).status).toBe(403);
    expect((await save(admin.cookie, { emailContacto: "no-es-email" })).status).toBe(422);
    expect((await save(admin.cookie, { emailContacto: "Hola@Tienda.Ejemplo", telefonoContacto: "+54 11 4444-0000" })).status).toBe(200);
    expect(await getStoreContact()).toEqual({ emailContacto: "hola@tienda.ejemplo", telefonoContacto: "+54 11 4444-0000" });

    const varianteId = await variant(5);
    await mergeRoute(apiRequest("/api/cart/merge", { cookie: ana.cookie, body: { items: [{ varianteId, cantidad: 1 }] } }));
    await checkout(ana.cookie, varianteId, "EFECTIVO");
    const notice = await db().notificacion.findFirstOrThrow({ where: { usuarioId: ana.id, tipo: "RESERVA_CREADA" } });
    expect(notice.mensaje).toContain("hola@tienda.ejemplo");
    expect(notice.mensaje).toContain("+54 11 4444-0000");
  });
});

describe("fecha comprometida de despacho (RN-14, RN-30)", () => {
  it("el admin la confirma: ventana de 48 h corridas, registro del cambio y aviso al cliente (CA-18)", async () => {
    const ana = await account("ana@ejemplo.com");
    const admin = await account("admin@tienda.ejemplo", { admin: true });
    const orderId = await confirmedOrder(ana.cookie);
    const fecha = new Date(Date.now() + 5 * 24 * HOUR);

    expect((await setDate(ana.cookie, orderId, fecha)).status).toBe(403);
    expect((await setDate(admin.cookie, orderId, fecha)).status).toBe(200);

    const order = await db().pedido.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.fechaDespachoComprometida).toEqual(fecha);
    expect(order.inicioVentanaCargo).toEqual(new Date(fecha.getTime() - 48 * HOUR));
    expect(order.ventanaCargoFija).toBe(false);
    expect(await db().cambioFechaDespacho.findFirstOrThrow({ where: { pedidoId: orderId } })).toMatchObject({
      fechaAnterior: null,
      fechaNueva: fecha,
      confirmadaCon48hOMenos: false,
      autorId: admin.id,
    });
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "FECHA_DESPACHO_CONFIRMADA" } })).toBe(1);
  });

  it("confirmada con 48 h o menos queda fija aunque después se posponga (T-70)", async () => {
    const ana = await account("ana@ejemplo.com");
    const admin = await account("admin@tienda.ejemplo", { admin: true });
    const orderId = await confirmedOrder(ana.cookie);

    await setDate(admin.cookie, orderId, new Date(Date.now() + 30 * HOUR));
    expect((await db().pedido.findUniqueOrThrow({ where: { id: orderId } })).ventanaCargoFija).toBe(true);

    const later = new Date(Date.now() + 5 * 24 * HOUR);
    await setDate(admin.cookie, orderId, later, "Demora del proveedor");
    const order = await db().pedido.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ fechaDespachoComprometida: later, ventanaCargoFija: true });
    expect(await db().cambioFechaDespacho.count({ where: { pedidoId: orderId } })).toBe(2);
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "FECHA_DESPACHO_CAMBIADA" } })).toBe(1);
  });

  it("un cambio sin marca fija recalcula la ventana sobre la nueva fecha (T-71)", async () => {
    const ana = await account("ana@ejemplo.com");
    const admin = await account("admin@tienda.ejemplo", { admin: true });
    const orderId = await confirmedOrder(ana.cookie);
    await setDate(admin.cookie, orderId, new Date(Date.now() + 5 * 24 * HOUR));

    const sooner = new Date(Date.now() + 4 * 24 * HOUR);
    await setDate(admin.cookie, orderId, sooner);
    const order = await db().pedido.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ inicioVentanaCargo: new Date(sooner.getTime() - 48 * HOUR), ventanaCargoFija: false });
  });

  it("rechaza fechas pasadas y pedidos sin pago", async () => {
    const ana = await account("ana@ejemplo.com");
    const admin = await account("admin@tienda.ejemplo", { admin: true });
    const orderId = await confirmedOrder(ana.cookie);

    expect((await (await setDate(admin.cookie, orderId, new Date(Date.now() - HOUR))).json()).codigo).toBe("FECHA_INVALIDA");
    await db().pedido.update({ where: { id: orderId }, data: { estado: "PENDIENTE_PAGO" } });
    expect((await (await setDate(admin.cookie, orderId, new Date(Date.now() + 5 * 24 * HOUR))).json()).codigo).toBe("ESTADO_INVALIDO");
  });
});

describe("registro dentro del checkout (RN-25)", () => {
  it("un visitante se registra, su carrito pasa a la cuenta y confirma el pedido sin volver a empezar", async () => {
    const varianteId = await variant(5);
    const visitor = await account("nueva@ejemplo.com");

    const merge = await (await mergeRoute(apiRequest("/api/cart/merge", { cookie: visitor.cookie, body: { items: [{ varianteId, cantidad: 2 }] } }))).json();
    expect(merge.carrito.items).toEqual([expect.objectContaining({ varianteId, cantidad: 2 })]);

    expect((await checkout(visitor.cookie, varianteId)).status).toBe(201);
  });
});
