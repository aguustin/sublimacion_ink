import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as storeCancelRoute } from "@/app/api/admin/orders/[id]/cancel/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { cancelByClient } from "@/server/modules/cancellations/cancellation.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { expireOnlinePayments } from "@/server/modules/orders/expiration.service";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();

type Account = { id: string; cookie: string; email: string };

async function account(email: string, admin = false): Promise<Account> {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1", telefono: "1155551234" } }),
  );
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response), email };
}

async function variant(precioCentavos: number, stock = 10) {
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const created = await createVariant(actor, product.id, { precioCentavos });
  await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: stock });
  return created.id;
}

async function checkout(user: Account, varianteId: string, precio: number, codigoCupon?: string) {
  await addItemRoute(apiRequest("/api/cart/items", { cookie: user.cookie, body: { varianteId, cantidad: 1 } }));
  return checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        modalidadCierre: "ONLINE",
        modalidadEntrega: "RETIRO",
        precios: [{ varianteId, precioUnitarioCentavos: precio }],
        codigoCupon,
      }),
    }),
  );
}

/** La tienda cancela un pedido de $1.500: el cliente recibe un cupón de $150. */
async function couponFor(user: Account) {
  const varianteId = await variant(150000);
  const id = (await (await checkout(user, varianteId, 150000)).json()).pedido.id as string;
  expect(
    (await storeCancelRoute(apiRequest(`/api/admin/orders/${id}/cancel`, { cookie: admin.cookie, body: { motivo: "Sin insumos" } }), params({ id })))
      .status,
  ).toBe(200);
  return db().cupon.findUniqueOrThrow({ where: { pedidoOrigenId: id } });
}

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

describe("cupones de compensación (RN-20)", () => {
  it("la tienda cancela: un cupón del 10 % sin envío, válido un mes, con aviso (T-81)", async () => {
    const coupon = await couponFor(ana);
    expect(coupon).toMatchObject({
      clienteId: ana.id,
      montoCentavos: 15000,
      porcentaje: 10,
      estado: "ACTIVO",
      codigo: expect.stringMatching(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/),
    });
    const days = (coupon.venceEn.getTime() - coupon.emitidoEn.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
    expect(await db().salidaNotificacion.count({ where: { destinatario: ana.email, tipo: "CUPON_EMITIDO" } })).toBe(1);
  });

  it("se usa en el checkout con tope en los productos y sin saldo; otro cliente o un cupón vencido se rechazan (T-84, T-85, T-88)", async () => {
    const coupon = await couponFor(ana);
    const cheap = await variant(10000);

    const bruno = await account("bruno@ejemplo.com");
    expect(await (await checkout(bruno, cheap, 10000, coupon.codigo)).json()).toMatchObject({ codigo: "CUPON_INVALIDO" });

    // Código escrito en minúsculas y sin guion: se normaliza.
    const response = await checkout(ana, cheap, 10000, coupon.codigo.replace("-", "").toLowerCase());
    expect(response.status).toBe(201);
    const order = await db().pedido.findUniqueOrThrow({ where: { id: (await response.json()).pedido.id } });
    expect(order).toMatchObject({ cuponId: coupon.id, subtotalProductosCentavos: 10000, descuentoCuponCentavos: 10000, totalCentavos: 0 });
    expect(await db().cupon.findUniqueOrThrow({ where: { id: coupon.id } })).toMatchObject({ estado: "USADO", usadoEnPedidoId: order.id });

    const expired = await couponFor(ana);
    await db().cupon.update({ where: { id: expired.id }, data: { venceEn: new Date(Date.now() - 60_000) } });
    expect(await (await checkout(ana, cheap, 10000, expired.codigo)).json()).toMatchObject({ codigo: "CUPON_INVALIDO" });
  });

  it("dos compras simultáneas con el mismo cupón: solo una lo usa y la otra no crea pedido ni retiene stock (T-86)", async () => {
    const coupon = await couponFor(ana);
    const varianteId = await variant(50000);
    const reservedBefore = (await db().variante.findUniqueOrThrow({ where: { id: varianteId } })).stockReservado;
    await addItemRoute(apiRequest("/api/cart/items", { cookie: ana.cookie, body: { varianteId, cantidad: 1 } }));

    const attempt = () =>
      checkoutRoute(
        new Request(`${APP_URL}/api/checkout`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: APP_URL, cookie: ana.cookie, "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            modalidadCierre: "ONLINE",
            modalidadEntrega: "RETIRO",
            precios: [{ varianteId, precioUnitarioCentavos: 50000 }],
            codigoCupon: coupon.codigo,
          }),
        }),
      );
    const statuses = (await Promise.all([attempt(), attempt()])).map((response) => response.status).sort();

    expect(statuses[0]).toBe(201);
    expect(statuses[1]).not.toBe(201);
    expect(await db().pedido.count({ where: { cuponId: coupon.id } })).toBe(1);
    expect((await db().variante.findUniqueOrThrow({ where: { id: varianteId } })).stockReservado).toBe(reservedBefore + 1);
  });

  it("si el pedido que lo usó vence o se cancela, vuelve una sola vez con su vencimiento original (T-87, T-101)", async () => {
    const coupon = await couponFor(ana);
    const varianteId = await variant(50000);

    const first = (await (await checkout(ana, varianteId, 50000, coupon.codigo)).json()).pedido.id as string;
    await db().pedido.update({ where: { id: first }, data: { venceEn: new Date(Date.now() - 1000) } });
    await expireOnlinePayments();
    expect(await db().cupon.findUniqueOrThrow({ where: { id: coupon.id } })).toMatchObject({
      estado: "ACTIVO",
      usadoEnPedidoId: null,
      venceEn: coupon.venceEn,
    });

    const second = (await (await checkout(ana, varianteId, 50000, coupon.codigo)).json()).pedido.id as string;
    const user = { id: ana.id, email: ana.email, nombre: "Persona", rol: "CLIENTE", telefono: "1155551234", emailVerificado: false } as never;
    await cancelByClient(user, second, { motivo: "Me arrepentí", cargoEsperadoCentavos: 0, aReembolsarEsperadoCentavos: 0 });
    expect(await db().cupon.findUniqueOrThrow({ where: { id: coupon.id } })).toMatchObject({ estado: "ACTIVO", venceEn: coupon.venceEn });
    expect(await db().eventoAuditoria.count({ where: { accion: "CUPON_RESTAURADO", entidadId: second } })).toBe(1);
  });

  it("la tienda cancela un pedido que usó un cupón: restaura el usado y emite uno nuevo sobre el subtotal original (T-102)", async () => {
    const coupon = await couponFor(ana);
    const varianteId = await variant(200000);
    const id = (await (await checkout(ana, varianteId, 200000, coupon.codigo)).json()).pedido.id as string;

    await storeCancelRoute(apiRequest(`/api/admin/orders/${id}/cancel`, { cookie: admin.cookie, body: { motivo: "Sin insumos" } }), params({ id }));

    expect(await db().cupon.findUniqueOrThrow({ where: { id: coupon.id } })).toMatchObject({ estado: "ACTIVO" });
    expect(await db().cupon.findUniqueOrThrow({ where: { pedidoOrigenId: id } })).toMatchObject({ montoCentavos: 20000 });
    expect(await db().cancelacion.findUniqueOrThrow({ where: { pedidoId: id } })).toMatchObject({
      descuentoCuponCentavos: 15000,
      productosCobradosCentavos: 185000,
    });
  });
});
