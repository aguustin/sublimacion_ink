import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as storeCancelRoute } from "@/app/api/admin/orders/[id]/cancel/route";
import { POST as cashPaymentRoute } from "@/app/api/admin/orders/[id]/cash-payment/route";
import { POST as quoteRoute } from "@/app/api/admin/orders/[id]/shipping-quote/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { POST as acceptRoute } from "@/app/api/orders/[id]/shipping/accept/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { createAddress } from "@/server/modules/users/profile.service";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();

type Account = { id: string; cookie: string };

async function account(email: string, admin = false): Promise<Account> {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1", telefono: "1155551234" } }),
  );
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

async function variant(precioCentavos: number) {
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const created = await createVariant(actor, product.id, { precioCentavos });
  await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: 10 });
  return created.id;
}

function checkout(user: Account, body: Record<string, unknown>, key: string = crypto.randomUUID()) {
  return checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": key },
      body: JSON.stringify(body),
    }),
  );
}

const addToCart = (user: Account, varianteId: string) =>
  addItemRoute(apiRequest("/api/cart/items", { cookie: user.cookie, body: { varianteId, cantidad: 1 } }));

/** Cupón de $150: la tienda cancela un pedido de $1.500 (RN-20). */
async function coupon(user: Account) {
  const varianteId = await variant(150000);
  await addToCart(user, varianteId);
  const created = await checkout(user, {
    modalidadCierre: "ONLINE",
    modalidadEntrega: "RETIRO",
    precios: [{ varianteId, precioUnitarioCentavos: 150000 }],
  });
  const id = (await created.json()).pedido.id as string;
  await storeCancelRoute(apiRequest(`/api/admin/orders/${id}/cancel`, { cookie: admin.cookie, body: { motivo: "Sin insumos" } }), params({ id }));
  return (await db().cupon.findUniqueOrThrow({ where: { pedidoOrigenId: id } })).codigo;
}

/** Checkout de un producto de `precio` con un cupón de $150. */
async function orderWithCoupon(user: Account, precio: number, extra: Record<string, unknown> = {}) {
  const codigoCupon = await coupon(user);
  const varianteId = await variant(precio);
  await addToCart(user, varianteId);
  const body = {
    modalidadCierre: "ONLINE",
    modalidadEntrega: "RETIRO",
    precios: [{ varianteId, precioUnitarioCentavos: precio }],
    codigoCupon,
    ...extra,
  };
  const response = await checkout(user, body);
  return { varianteId, id: (await response.json()).pedido.id as string, status: response.status };
}

const quote = async (id: string, importeCentavos: number) =>
  (
    await (
      await quoteRoute(
        apiRequest(`/api/admin/orders/${id}/shipping-quote`, { cookie: admin.cookie, body: { envioPosible: true, importeCentavos } }),
        params({ id }),
      )
    ).json()
  ).cotizacion.id as string;
const accept = (id: string, cotizacionId: string, totalEsperadoCentavos: number) =>
  acceptRoute(apiRequest(`/api/orders/${id}/shipping/accept`, { cookie: ana.cookie, body: { cotizacionId, totalEsperadoCentavos } }), params({ id }));
const reservedOf = async (id: string) => (await db().variante.findUniqueOrThrow({ where: { id } })).stockReservado;

let admin: Account;
let ana: Account;

beforeEach(async () => {
  await resetDatabase();
  admin = await account("admin@tienda.ejemplo", true);
  ana = await account("ana@ejemplo.com");
});
afterAll(async () => {
  await db().$disconnect();
});

describe("pedidos con total final de $0 (RN-32)", () => {
  it("se confirman sin pasarela ni pago, con el stock retenido; pagar o registrar efectivo se rechaza", async () => {
    const { varianteId, id, status } = await orderWithCoupon(ana, 15000);
    expect(status).toBe(201);

    const order = await db().pedido.findUniqueOrThrow({ where: { id }, include: { historial: true, pagos: true, retenciones: true } });
    expect(order).toMatchObject({
      estado: "CONFIRMADO",
      totalCentavos: 0,
      descuentoCuponCentavos: 15000,
      venceEn: null,
      porcentajeCargoCancelacion: 15,
      pagos: [],
    });
    expect(order.historial).toEqual([expect.objectContaining({ estadoNuevo: "CONFIRMADO", motivo: "SIN_PAGO_REQUERIDO" })]);
    expect(order.retenciones).toEqual([expect.objectContaining({ estado: "ACTIVA" })]);
    expect(await reservedOf(varianteId)).toBe(1);

    const pay = await payRoute(
      apiRequest(`/api/payments/simulated/${id}`, { cookie: ana.cookie, body: { resultado: "APROBADO" } }),
      params({ orderId: id }),
    );
    expect(pay.status).toBe(409);
    const cash = await cashPaymentRoute(apiRequest(`/api/admin/orders/${id}/cash-payment`, { cookie: admin.cookie }), params({ id }));
    expect(cash.status).toBe(409);
    expect(await db().pago.count({ where: { pedidoId: id } })).toBe(0);
  });

  it("con importe positivo el flujo no cambia: queda pendiente de pago", async () => {
    const { id } = await orderWithCoupon(ana, 20000);
    const order = await db().pedido.findUniqueOrThrow({ where: { id } });
    expect(order).toMatchObject({ estado: "PENDIENTE_PAGO", totalCentavos: 5000 });
    expect(order.venceEn).not.toBeNull();
  });

  it("la misma solicitud repetida a la vez crea y confirma un solo pedido, con una sola retención", async () => {
    const codigoCupon = await coupon(ana);
    const varianteId = await variant(15000);
    await addToCart(ana, varianteId);
    const body = { modalidadCierre: "EFECTIVO", modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: 15000 }], codigoCupon };
    const key = crypto.randomUUID();

    const responses = await Promise.all([checkout(ana, body, key), checkout(ana, body, key)]);
    const ids = new Set(await Promise.all(responses.map(async (response) => (await response.json()).pedido.id)));

    expect(ids.size).toBe(1);
    expect(await db().pedido.count({ where: { estado: "CONFIRMADO" } })).toBe(1);
    expect(await db().historialEstadoPedido.count({ where: { estadoNuevo: "CONFIRMADO" } })).toBe(1);
    expect(await reservedOf(varianteId)).toBe(1);
  });

  it("con envío, productos en $0 no alcanzan: decide el total con el envío cotizado", async () => {
    const direccionId = (await createAddress(ana.id, { calle: "Calle 1", ciudad: "Rosario", provincia: "Santa Fe", codigoPostal: "2000" })).id;

    const paid = await orderWithCoupon(ana, 15000, { modalidadEntrega: "ENVIO", direccionId });
    expect(await db().pedido.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ estado: "ENVIO_A_COTIZAR", totalCentavos: 0 });
    expect((await accept(paid.id, await quote(paid.id, 3000), 3000)).status).toBe(200);
    expect(await db().pedido.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ estado: "PENDIENTE_PAGO", totalCentavos: 3000 });

    const free = await orderWithCoupon(ana, 15000, { modalidadEntrega: "ENVIO", direccionId });
    expect((await accept(free.id, await quote(free.id, 0), 0)).status).toBe(200);
    expect(await db().pedido.findUniqueOrThrow({ where: { id: free.id }, include: { pagos: true } })).toMatchObject({
      estado: "CONFIRMADO",
      totalCentavos: 0,
      venceEn: null,
      pagos: [],
    });
  });
});
