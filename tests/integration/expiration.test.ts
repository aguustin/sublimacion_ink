import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cleanupRoute } from "@/app/api/internal/jobs/cleanup/route";
import { POST as expireOnlineRoute } from "@/app/api/internal/jobs/expire-online-payments/route";
import { POST as reconcileRoute } from "@/app/api/internal/jobs/reconcile-stock/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { expireCashReservations, expireOnlinePayments } from "@/server/modules/orders/expiration.service";
import { assertCronAuthorized } from "@/server/shared/cron";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();
const CRON_SECRET = "secreto-de-pruebas-del-cron-0123456789";

async function variant(stock: number) {
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const created = await createVariant(actor, product.id, { precioCentavos: 150000 });
  await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: stock });
  return created.id;
}

async function client(email: string) {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Ana", email, contrasena: "clave-segura-1", telefono: "1155551234" } }),
  );
  return { id: (await response.json()).usuario.id as string, cookie: sessionCookieFrom(response) };
}

function checkout(cookie: string, varianteId: string, modalidadCierre: "ONLINE" | "EFECTIVO") {
  return checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ modalidadCierre, modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: 150000 }] }),
    }),
  );
}

async function order(cookie: string, varianteId: string, modalidadCierre: "ONLINE" | "EFECTIVO" = "ONLINE", cantidad = 1) {
  await addItemRoute(apiRequest("/api/cart/items", { cookie, body: { varianteId, cantidad } }));
  const response = await checkout(cookie, varianteId, modalidadCierre);
  expect(response.status).toBe(201);
  return (await response.json()).pedido.id as string;
}

const overdue = (orderId: string) => db().pedido.update({ where: { id: orderId }, data: { venceEn: new Date(Date.now() - 1000) } });
const stockOf = async (id: string) => (await db().variante.findUniqueOrThrow({ where: { id } })).stockReservado;
const cron = (handler: (request: Request) => Promise<Response>, path: string, secret?: string) =>
  handler(new Request(`${APP_URL}${path}`, { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

beforeEach(resetDatabase);
afterAll(async () => {
  await db().$disconnect();
});

describe("vencimiento de pagos online (RN-22) y de reservas (RN-06)", () => {
  it("vence un pago online vencido y libera el stock con su motivo (T-10, T-94)", async () => {
    const ana = await client("ana@ejemplo.com");
    const varianteId = await variant(3);
    const orderId = await order(ana.cookie, varianteId, "ONLINE", 2);
    await overdue(orderId);

    expect(await expireOnlinePayments()).toEqual({ revisados: 1, vencidos: 1 });

    const expired = await db().pedido.findUniqueOrThrow({ where: { id: orderId }, include: { historial: true, retenciones: true } });
    expect(expired.estado).toBe("VENCIDO");
    expect(expired.historial.at(-1)).toMatchObject({ estadoAnterior: "PENDIENTE_PAGO", estadoNuevo: "VENCIDO", motivo: "VENCIMIENTO_PAGO_ONLINE" });
    expect(expired.retenciones).toEqual([expect.objectContaining({ estado: "LIBERADA", motivoLiberacion: "VENCIMIENTO_PAGO_ONLINE" })]);
    expect(await stockOf(varianteId)).toBe(0);
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "PAGO_VENCIDO" } })).toBe(1);
  });

  it("no vence lo que todavía está en plazo ni lo ya pagado (T-12, T-14)", async () => {
    const ana = await client("ana@ejemplo.com");
    const varianteId = await variant(5);
    await order(ana.cookie, varianteId);
    const paid = await order(ana.cookie, varianteId);
    await payRoute(apiRequest(`/api/payments/simulated/${paid}`, { cookie: ana.cookie, body: { resultado: "APROBADO" } }), params({ orderId: paid }));
    await db().pedido.update({ where: { id: paid }, data: { venceEn: new Date(Date.now() - 1000) } });

    expect(await expireOnlinePayments()).toEqual({ revisados: 0, vencidos: 0 });
    expect(await stockOf(varianteId)).toBe(2);
  });

  it("cada proceso solo vence su propio estado (T-103)", async () => {
    const ana = await client("ana@ejemplo.com");
    const varianteId = await variant(5);
    const online = await order(ana.cookie, varianteId, "ONLINE");
    const cash = await order(ana.cookie, varianteId, "EFECTIVO");
    await overdue(online);
    await overdue(cash);

    await expireOnlinePayments();
    expect((await db().pedido.findUniqueOrThrow({ where: { id: cash } })).estado).toBe("RESERVADO");

    expect(await expireCashReservations()).toEqual({ revisados: 1, vencidos: 1 });
    const retention = await db().retencionStock.findFirstOrThrow({ where: { pedidoId: cash } });
    expect(retention.motivoLiberacion).toBe("VENCIMIENTO_RESERVA");
    expect(await stockOf(varianteId)).toBe(0);
  });

  it("ejecutarlo varias veces, también en paralelo, libera el stock una sola vez (T-11)", async () => {
    const ana = await client("ana@ejemplo.com");
    const varianteId = await variant(5);
    const orderId = await order(ana.cookie, varianteId, "ONLINE", 3);
    await overdue(orderId);

    const results = await Promise.all([expireOnlinePayments(), expireOnlinePayments(), expireOnlinePayments()]);
    await expireOnlinePayments();

    expect(results.reduce((sum, result) => sum + result.vencidos, 0)).toBe(1);
    expect(await stockOf(varianteId)).toBe(0);
    expect(await db().movimientoStock.count({ where: { tipo: "LIBERACION" } })).toBe(1);
    expect(await db().historialEstadoPedido.count({ where: { pedidoId: orderId, estadoNuevo: "VENCIDO" } })).toBe(1);
  });

  it("saltea un pedido bloqueado por otra operación y lo vence en la siguiente ejecución (T-15)", async () => {
    const ana = await client("ana@ejemplo.com");
    const varianteId = await variant(5);
    const locked = await order(ana.cookie, varianteId);
    const free = await order(ana.cookie, varianteId);
    await overdue(locked);
    await overdue(free);

    let release!: () => void;
    const holding = db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pedido WHERE id = ${locked}::uuid FOR UPDATE`;
      await new Promise<void>((resolve) => (release = resolve));
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await expireOnlinePayments()).toEqual({ revisados: 2, vencidos: 1 });
    release();
    await holding;
    expect(await expireOnlinePayments()).toEqual({ revisados: 1, vencidos: 1 });
    expect(await stockOf(varianteId)).toBe(0);
  });

  it("pago y vencimiento simultáneos dejan un estado coherente (T-16)", async () => {
    const ana = await client("ana@ejemplo.com");
    const varianteId = await variant(5);
    const orderId = await order(ana.cookie, varianteId);
    await db().pedido.update({ where: { id: orderId }, data: { venceEn: new Date(Date.now() + 150) } });
    await new Promise((resolve) => setTimeout(resolve, 150));

    await Promise.all([
      payRoute(apiRequest(`/api/payments/simulated/${orderId}`, { cookie: ana.cookie, body: { resultado: "APROBADO" } }), params({ orderId })),
      expireOnlinePayments(),
    ]);

    const final = await db().pedido.findUniqueOrThrow({ where: { id: orderId }, include: { pagos: true } });
    const approved = final.pagos.filter((payment) => payment.estado === "APROBADO").length;
    if (final.estado === "CONFIRMADO") {
      expect(approved).toBe(1);
      expect(await stockOf(varianteId)).toBe(1);
    } else {
      expect(final.estado).toBe("VENCIDO");
      expect(approved).toBe(0);
      expect(await stockOf(varianteId)).toBe(0);
    }
  });

  it("después de vencer, el pedido no se puede pagar (T-104)", async () => {
    const ana = await client("ana@ejemplo.com");
    const orderId = await order(ana.cookie, await variant(5));
    await overdue(orderId);
    await expireOnlinePayments();

    const response = await payRoute(apiRequest(`/api/payments/simulated/${orderId}`, { cookie: ana.cookie, body: { resultado: "APROBADO" } }), params({ orderId }));
    expect(response.status).toBe(409);
    expect(await db().pago.count()).toBe(0);
  });
});

describe("vencimiento oportunista (14.5)", () => {
  it("al confirmar: si la última unidad la retiene un pedido vencido sin procesar, la compra nueva la obtiene", async () => {
    const ana = await client("ana@ejemplo.com");
    const bruno = await client("bruno@ejemplo.com");
    const varianteId = await variant(1);
    await addItemRoute(apiRequest("/api/cart/items", { cookie: bruno.cookie, body: { varianteId, cantidad: 1 } }));
    const abandoned = await order(ana.cookie, varianteId);
    await overdue(abandoned);

    expect((await checkout(bruno.cookie, varianteId, "ONLINE")).status).toBe(201);
    expect((await db().pedido.findUniqueOrThrow({ where: { id: abandoned } })).estado).toBe("VENCIDO");
    expect(await stockOf(varianteId)).toBe(1);
  });

  it("al agregar al carrito: tampoco bloquea un pedido vencido sin procesar", async () => {
    const ana = await client("ana@ejemplo.com");
    const bruno = await client("bruno@ejemplo.com");
    const varianteId = await variant(1);
    await overdue(await order(ana.cookie, varianteId));

    const response = await addItemRoute(apiRequest("/api/cart/items", { cookie: bruno.cookie, body: { varianteId, cantidad: 1 } }));
    expect(response.status).toBe(200);
    expect(await stockOf(varianteId)).toBe(0);
  });

  it("sin pedidos vencidos, la falta de stock se informa como siempre", async () => {
    const ana = await client("ana@ejemplo.com");
    const bruno = await client("bruno@ejemplo.com");
    const varianteId = await variant(1);
    await addItemRoute(apiRequest("/api/cart/items", { cookie: bruno.cookie, body: { varianteId, cantidad: 1 } }));
    await order(ana.cookie, varianteId);

    const response = await checkout(bruno.cookie, varianteId, "ONLINE");
    expect(response.status).toBe(409);
    expect((await response.json()).codigo).toBe("STOCK_INSUFICIENTE");
    expect((await addItemRoute(apiRequest("/api/cart/items", { cookie: bruno.cookie, body: { varianteId, cantidad: 1 } }))).status).toBe(409);
  });
});

describe("endpoints del cron", () => {
  it("exigen el secreto y no existen si no está configurado", async () => {
    expect((await cron(expireOnlineRoute, "/api/internal/jobs/expire-online-payments")).status).toBe(401);
    expect((await cron(expireOnlineRoute, "/api/internal/jobs/expire-online-payments", "x".repeat(40))).status).toBe(401);
    const ok = await cron(expireOnlineRoute, "/api/internal/jobs/expire-online-payments", CRON_SECRET);
    expect(await ok.json()).toEqual({ revisados: 0, vencidos: 0 });
    expect(() => assertCronAuthorized(new Request(APP_URL), "")).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("la conciliación informa cero diferencias y la limpieza borra solo lo vencido (R-22)", async () => {
    const ana = await client("ana@ejemplo.com");
    await db().sesion.create({ data: { usuarioId: ana.id, hashToken: "vencida", expiraEn: new Date(Date.now() - 1000) } });
    await db().limiteSolicitud.create({ data: { clave: "vieja", ventanaInicio: new Date(Date.now() - 2 * 86_400_000), cantidad: 1 } });

    expect(await (await cron(reconcileRoute, "/api/internal/jobs/reconcile-stock", CRON_SECRET)).json()).toEqual({ diferencias: 0 });
    const cleaned = await (await cron(cleanupRoute, "/api/internal/jobs/cleanup", CRON_SECRET)).json();

    expect(cleaned).toMatchObject({ sesiones: 1, limites: 1 });
    expect(await db().sesion.count({ where: { usuarioId: ana.id } })).toBe(1);
  });
});
