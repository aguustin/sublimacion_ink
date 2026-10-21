import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cashPaymentRoute } from "@/app/api/admin/orders/[id]/cash-payment/route";
import { POST as extendRoute } from "@/app/api/admin/orders/[id]/extend-reservation/route";
import { GET as previewRoute, POST as reactivateRoute } from "@/app/api/admin/orders/[id]/reactivate/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { createCategory, createProduct, createVariant, updateVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { expireCashReservations } from "@/server/modules/orders/expiration.service";
import { reservationExpiry } from "@/server/modules/orders/reservation.policy";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();
const TZ = "America/Argentina/Buenos_Aires";
const DAY = 86_400_000;

async function account(email: string, admin = false) {
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

async function order(cookie: string, varianteId: string, modalidadCierre: "ONLINE" | "EFECTIVO" = "EFECTIVO", precio = 150000) {
  await addItemRoute(apiRequest("/api/cart/items", { cookie, body: { varianteId, cantidad: 1 } }));
  const response = await checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ modalidadCierre, modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: precio }] }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).pedido.id as string;
}

/** Reserva vencida por el proceso de INC-06.1, como en la operación real. */
async function expiredReservation(cookie: string, varianteId: string) {
  const id = await order(cookie, varianteId);
  await db().pedido.update({ where: { id }, data: { venceEn: new Date(Date.now() - 1000) } });
  await expireCashReservations();
  return id;
}

const extend = (cookie: string, id: string, body: unknown) =>
  extendRoute(apiRequest(`/api/admin/orders/${id}/extend-reservation`, { cookie, body }), params({ id }));
const reactivate = (cookie: string, id: string, body: unknown) =>
  reactivateRoute(apiRequest(`/api/admin/orders/${id}/reactivate`, { cookie, body }), params({ id }));
const preview = async (cookie: string, id: string) =>
  (await previewRoute(apiRequest(`/api/admin/orders/${id}/reactivate`, { method: "GET", cookie }), params({ id }))).json();
const reservedOf = async (id: string) => (await db().variante.findUniqueOrThrow({ where: { id } })).stockReservado;

let admin: { id: string; cookie: string };
let client: { id: string; cookie: string };

beforeEach(async () => {
  await resetDatabase();
  admin = await account("admin@tienda.ejemplo", true);
  client = await account("ana@ejemplo.com");
});
afterAll(async () => {
  await db().$disconnect();
});

describe("extensión de una reserva vigente (RN-28)", () => {
  it("el cliente no puede extender ni reactivar (T-120)", async () => {
    const id = await order(client.cookie, await variant(3));
    expect((await extend(client.cookie, id, { venceEn: new Date(Date.now() + 3 * DAY).toISOString(), motivo: "Pido más tiempo" })).status).toBe(403);
    expect((await reactivate(client.cookie, id, { motivo: "Volví", totalEsperadoCentavos: 150000 })).status).toBe(403);
  });

  it("extiende con motivo, registra la fecha anterior y la nueva, audita y avisa (T-121)", async () => {
    const id = await order(client.cookie, await variant(3));
    const before = (await db().pedido.findUniqueOrThrow({ where: { id } })).venceEn!;
    const venceEn = new Date(before.getTime() + 2 * DAY);

    expect((await extend(admin.cookie, id, { venceEn: venceEn.toISOString(), motivo: "Viene el lunes" })).status).toBe(200);

    expect((await db().pedido.findUniqueOrThrow({ where: { id } })).venceEn).toEqual(venceEn);
    expect(await db().extensionReserva.findFirstOrThrow({ where: { pedidoId: id } })).toMatchObject({
      tipo: "EXTENSION",
      venceEnAnterior: before,
      venceEnNuevo: venceEn,
      motivo: "Viene el lunes",
      autorId: admin.id,
    });
    expect(await db().eventoAuditoria.count({ where: { accion: "RESERVA_EXTENDIDA", entidadId: id } })).toBe(1);
    expect(await db().notificacion.count({ where: { usuarioId: client.id, tipo: "RESERVA_EXTENDIDA" } })).toBe(1);
  });

  it("rechaza sin motivo, con una fecha que no extiende, reservas vencidas y pagos online", async () => {
    const id = await order(client.cookie, await variant(5));
    const current = (await db().pedido.findUniqueOrThrow({ where: { id } })).venceEn!;

    expect((await extend(admin.cookie, id, { venceEn: new Date(current.getTime() + DAY).toISOString(), motivo: "" })).status).toBe(422);
    expect((await (await extend(admin.cookie, id, { venceEn: new Date(current.getTime() - 60_000).toISOString(), motivo: "Por las dudas" })).json()).codigo).toBe("FECHA_INVALIDA");

    await db().pedido.update({ where: { id }, data: { venceEn: new Date(Date.now() - 1000) } });
    expect((await (await extend(admin.cookie, id, { venceEn: new Date(Date.now() + DAY).toISOString(), motivo: "Tarde" })).json()).codigo).toBe("RESERVA_VENCIDA");

    const online = await order(client.cookie, await variant(5), "ONLINE");
    expect((await (await extend(admin.cookie, online, { venceEn: new Date(Date.now() + DAY).toISOString(), motivo: "No aplica" })).json()).codigo).toBe("ESTADO_INVALIDO");
  });

  it("una reserva extendida no vence con el plazo original", async () => {
    const id = await order(client.cookie, await variant(3));
    await extend(admin.cookie, id, { venceEn: new Date(Date.now() + 5 * DAY).toISOString(), motivo: "Viaja" });
    await expireCashReservations();
    expect((await db().pedido.findUniqueOrThrow({ where: { id } })).estado).toBe("RESERVADO");
  });
});

describe("reactivación de una reserva vencida (RN-28)", () => {
  it("con stock: vuelve a RESERVADO a precios vigentes, retiene el stock y vence en 24 h hábiles (T-122)", async () => {
    const varianteId = await variant(3, 150000);
    const id = await expiredReservation(client.cookie, varianteId);
    expect(await reservedOf(varianteId)).toBe(0);
    await updateVariant(actor, varianteId, { precioCentavos: 180000 });

    const view = await preview(admin.cookie, id);
    expect(view).toMatchObject({ totalCentavos: 180000, puedeReactivarse: true });

    const start = new Date();
    expect((await reactivate(admin.cookie, id, { motivo: "Vino a pagar tarde", totalEsperadoCentavos: 180000 })).status).toBe(200);
    const end = new Date();

    const reactivated = await db().pedido.findUniqueOrThrow({ where: { id }, include: { items: true, retenciones: true, historial: { orderBy: { creadoEn: "desc" } } } });
    expect(reactivated).toMatchObject({ estado: "RESERVADO", totalCentavos: 180000, subtotalProductosCentavos: 180000 });
    expect(reactivated.items[0]?.precioUnitarioCentavos).toBe(180000);
    expect(reactivated.retenciones.map((retention) => retention.estado).sort()).toEqual(["ACTIVA", "LIBERADA"]);
    expect(await reservedOf(varianteId)).toBe(1);
    expect(reactivated.historial[0]).toMatchObject({ estadoAnterior: "VENCIDO", estadoNuevo: "RESERVADO", actorId: admin.id });
    expect(reactivated.venceEn!.getTime()).toBeGreaterThanOrEqual(reservationExpiry(start, new Set(), TZ).getTime());
    expect(reactivated.venceEn!.getTime()).toBeLessThanOrEqual(reservationExpiry(end, new Set(), TZ).getTime());
    expect(await db().extensionReserva.count({ where: { pedidoId: id, tipo: "REACTIVACION" } })).toBe(1);
    expect(await db().notificacion.count({ where: { usuarioId: client.id, tipo: "RESERVA_REACTIVADA" } })).toBe(1);

    // Sigue el circuito normal: el admin registra el efectivo.
    const paid = await cashPaymentRoute(apiRequest(`/api/admin/orders/${id}/cash-payment`, { cookie: admin.cookie }), params({ id }));
    expect(paid.status).toBe(201);
  });

  it("sin stock no cambia nada (T-122)", async () => {
    const varianteId = await variant(1);
    const id = await expiredReservation(client.cookie, varianteId);
    const other = await account("bruno@ejemplo.com");
    await order(other.cookie, varianteId, "ONLINE");

    expect((await preview(admin.cookie, id)).puedeReactivarse).toBe(false);
    const response = await reactivate(admin.cookie, id, { motivo: "Intento", totalEsperadoCentavos: 150000 });
    expect(response.status).toBe(409);
    expect((await response.json()).codigo).toBe("STOCK_INSUFICIENTE");
    expect((await db().pedido.findUniqueOrThrow({ where: { id } })).estado).toBe("VENCIDO");
    expect(await reservedOf(varianteId)).toBe(1);
    expect(await db().extensionReserva.count()).toBe(0);
  });

  it("compite por la última unidad con una compra: solo uno la obtiene (T-123)", async () => {
    const varianteId = await variant(1);
    const id = await expiredReservation(client.cookie, varianteId);
    const other = await account("bruno@ejemplo.com");
    await addItemRoute(apiRequest("/api/cart/items", { cookie: other.cookie, body: { varianteId, cantidad: 1 } }));

    const [reactivation, purchase] = await Promise.all([
      reactivate(admin.cookie, id, { motivo: "Vino a pagar", totalEsperadoCentavos: 150000 }),
      checkoutRoute(
        new Request(`${APP_URL}/api/checkout`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: APP_URL, cookie: other.cookie, "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ modalidadCierre: "ONLINE", modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: 150000 }] }),
        }),
      ),
    ]);

    expect([reactivation.status, purchase.status].sort()).toEqual([200, 409].sort((a, b) => a - b));
    expect([reactivation.ok, purchase.ok].filter(Boolean)).toHaveLength(1);
    expect(await reservedOf(varianteId)).toBe(1);
  });

  it("dos reactivaciones simultáneas: una sola retiene el stock", async () => {
    const varianteId = await variant(5);
    const id = await expiredReservation(client.cookie, varianteId);

    const statuses = await Promise.all([1, 2].map(async () => (await reactivate(admin.cookie, id, { motivo: "Doble clic", totalEsperadoCentavos: 150000 })).status));

    expect(statuses.sort()).toEqual([200, 409]);
    expect(await reservedOf(varianteId)).toBe(1);
  });

  it("rechaza personalizados, pagos online vencidos y un total desactualizado (T-124)", async () => {
    const varianteId = await variant(5);
    const id = await expiredReservation(client.cookie, varianteId);

    const stale = await reactivate(admin.cookie, id, { motivo: "Total viejo", totalEsperadoCentavos: 100000 });
    expect(await stale.json()).toMatchObject({ codigo: "PRECIO_CAMBIADO", detalles: { totalCentavos: 150000 } });

    await db().pedido.update({ where: { id }, data: { tipo: "PERSONALIZADO" } });
    const custom = await reactivate(admin.cookie, id, { motivo: "Personalizado", totalEsperadoCentavos: 150000 });
    expect(await custom.json()).toMatchObject({ codigo: "REACTIVACION_NO_PERMITIDA", mensaje: expect.stringContaining("reemití la cotización") });

    const online = await order(client.cookie, varianteId, "ONLINE");
    await db().pedido.update({ where: { id: online }, data: { venceEn: new Date(Date.now() - 1000), estado: "VENCIDO" } });
    expect((await (await reactivate(admin.cookie, online, { motivo: "Online", totalEsperadoCentavos: 150000 })).json()).codigo).toBe("REACTIVACION_NO_PERMITIDA");
  });
});
