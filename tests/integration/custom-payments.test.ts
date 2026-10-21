import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as quoteRoute } from "@/app/api/admin/custom-orders/[id]/quote/route";
import { POST as storeCancelRoute } from "@/app/api/admin/orders/[id]/cancel/route";
import { POST as cashRoute } from "@/app/api/admin/orders/[id]/cash-payment/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { POST as acceptRoute } from "@/app/api/custom-orders/[id]/quote/accept/route";
import { POST as requestRoute } from "@/app/api/custom-orders/route";
import { POST as cancelRoute } from "@/app/api/orders/[id]/cancel/route";
import { GET as cancelPreviewRoute } from "@/app/api/orders/[id]/cancellation-preview/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { transitionOrder } from "@/server/modules/orders/order-transitions";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const db = () => getDb();
const HOUR = 3_600_000;

type Account = { id: string; cookie: string };

async function account(email: string, admin = false): Promise<Account> {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1", telefono: "1155551234" } }),
  );
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

/**
 * Personalizado aceptado: 2 unidades a $5.000 = $10.000 de productos; seña del 20 % = $2.000.
 * Con `envio`, la cotización suma ese costo, que se cobra con el saldo (D-48).
 */
async function acceptedOrder(
  user: Account,
  { modalidadCierre = "ONLINE", envio, cupon, precio = 500000 }: { modalidadCierre?: string; envio?: number; cupon?: string; precio?: number } = {},
) {
  const actor = { id: admin.id };
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Cartel", categoriaId: category.id, tipo: "PERSONALIZABLE" });
  const varianteId = (await createVariant(actor, product.id, { material: "Lona" })).id;
  const direccion =
    envio === undefined
      ? null
      : await db().direccion.create({
          data: { usuarioId: user.id, calle: "Calle 1", ciudad: "Rosario", provincia: "Santa Fe", codigoPostal: "2000" },
        });

  const created = await requestRoute(
    new Request(`${APP_URL}/api/custom-orders`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        varianteId,
        cantidad: 2,
        descripcion: "Cartel con el logo del local",
        fechaDeseada: "2026-12-01",
        modalidadEntrega: direccion ? "ENVIO" : "RETIRO",
        ...(direccion && { direccionId: direccion.id }),
      }),
    }),
  );
  const id = (await created.json()).pedido.id as string;
  const quoted = await quoteRoute(
    apiRequest(`/api/admin/custom-orders/${id}/quote`, {
      cookie: admin.cookie,
      body: {
        precioUnitarioCentavos: precio,
        fechaEntregaPropuesta: "2026-12-10",
        detalle: "Lona",
        ...(envio !== undefined && { costoEnvioCentavos: envio }),
      },
    }),
    params({ id }),
  );
  const cotizacionId = (await quoted.json()).cotizacion.id;
  const preview = await db().cupon.findUnique({ where: { codigo: cupon ?? "" } });
  const discount = preview ? Math.min(preview.montoCentavos, precio * 2) : 0;
  const accepted = await acceptRoute(
    apiRequest(`/api/custom-orders/${id}/quote/accept`, {
      cookie: user.cookie,
      body: { cotizacionId, modalidadCierre, totalEsperadoCentavos: precio * 2 - discount + (envio ?? 0), ...(cupon && { codigoCupon: cupon }) },
    }),
    params({ id }),
  );
  expect(accepted.status).toBe(200);
  return id;
}

/** Cupón de compensación: la tienda cancela un pedido estándar de `subtotal` (10 %, RN-20). */
async function couponFor(user: Account, subtotal: number) {
  const actor = { id: admin.id };
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const varianteId = (await createVariant(actor, product.id, { precioCentavos: subtotal })).id;
  await registerVariantMovement(actor, varianteId, { tipo: "INGRESO", cantidad: 1 });
  await addItemRoute(apiRequest("/api/cart/items", { cookie: user.cookie, body: { varianteId, cantidad: 1 } }));
  const response = await checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ modalidadCierre: "ONLINE", modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: subtotal }] }),
    }),
  );
  const id = (await response.json()).pedido.id as string;
  await storeCancelRoute(apiRequest(`/api/admin/orders/${id}/cancel`, { cookie: admin.cookie, body: { motivo: "Sin insumos" } }), params({ id }));
  return (await db().cupon.findUniqueOrThrow({ where: { pedidoOrigenId: id } })).codigo;
}

const pay = (user: Account, id: string, body: Record<string, unknown> = {}) =>
  payRoute(apiRequest(`/api/payments/simulated/${id}`, { cookie: user.cookie, body: { resultado: "APROBADO", ...body } }), params({ orderId: id }));
const cash = (id: string) => cashRoute(apiRequest(`/api/admin/orders/${id}/cash-payment`, { cookie: admin.cookie }), params({ id }));
const orderOf = (id: string) => db().pedido.findUniqueOrThrow({ where: { id }, include: { pagos: true, retenciones: true, historial: true } });
const approved = (id: string, concepto: "SENA" | "SALDO") => db().pago.findMany({ where: { pedidoId: id, concepto, estado: "APROBADO" } });
const transition = (id: string, from: "CONFIRMADO" | "LISTO_PARA_RETIRO", to: "DESPACHADO" | "ENTREGADO") =>
  db().$transaction((tx) => transitionOrder(tx, { pedidoId: id, from, to }));

/** RN-07 (INC-09): el despacho exige el diseño vigente aprobado; acá se prepara directamente. */
async function approvedDesign(id: string) {
  const item = await db().itemPedido.findFirstOrThrow({ where: { pedidoId: id } });
  const design = await db().diseno.create({ data: { itemPedidoId: item.id, estado: "APROBADO" } });
  const version = await db().versionDiseno.create({ data: { disenoId: design.id, numero: 1, creadaPorId: admin.id, huella: "a".repeat(64) } });
  await db().aprobacionDiseno.create({ data: { versionId: version.id, aprobadaPorId: ana.id, huellaAprobada: version.huella } });
  await db().diseno.update({ where: { id: design.id }, data: { versionVigenteId: version.id } });
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

describe("seña (RN-21, RN-16)", () => {
  it("online: cobra exactamente la seña y confirma el pedido (T-89)", async () => {
    const id = await acceptedOrder(ana);
    expect((await pay(ana, id)).status).toBe(201);
    const order = await orderOf(id);
    expect(order.estado).toBe("CONFIRMADO");
    expect(order.pagos).toEqual([expect.objectContaining({ concepto: "SENA", medio: "ONLINE", importeCentavos: 200000, estado: "APROBADO" })]);
  });

  it("con cupón, la seña es el 20 % de los productos después del descuento (T-89, D-40)", async () => {
    const cupon = await couponFor(ana, 150000);
    const id = await acceptedOrder(ana, { cupon });
    await pay(ana, id);
    expect((await approved(id, "SENA"))[0]).toMatchObject({ importeCentavos: 197000 }); // 20 % de $10.000 − $150
  });

  it("en efectivo la registra el admin dentro del plazo; vencido el plazo, se rechaza (RN-17)", async () => {
    const id = await acceptedOrder(ana, { modalidadCierre: "EFECTIVO" });
    expect((await cash(id)).status).toBe(201);
    expect(await orderOf(id)).toMatchObject({
      estado: "CONFIRMADO",
      pagos: [expect.objectContaining({ concepto: "SENA", medio: "EFECTIVO", importeCentavos: 200000 })],
    });

    const late = await acceptedOrder(ana, { modalidadCierre: "EFECTIVO" });
    await db().pedido.update({ where: { id: late }, data: { venceEn: new Date(Date.now() - 1000) } });
    expect(await (await cash(late)).json()).toMatchObject({ codigo: "RESERVA_VENCIDA" });
  });

  it("un concepto que no corresponde se rechaza sin registrar nada", async () => {
    const id = await acceptedOrder(ana);
    expect(await (await pay(ana, id, { concepto: "SALDO" })).json()).toMatchObject({ codigo: "CONCEPTO_INVALIDO", detalles: { concepto: "SENA" } });
    expect(await db().pago.count({ where: { pedidoId: id } })).toBe(0);
  });
});

describe("saldo (RN-21, D-38)", () => {
  it("online: cobra total − seña, sin cambiar el estado, sin plazo nuevo ni retención; no se cobra dos veces (T-105)", async () => {
    const id = await acceptedOrder(ana);
    await pay(ana, id);
    const before = await orderOf(id);

    // Un intento rechazado se registra y no bloquea el pago aprobado posterior (índice único solo sobre aprobados).
    expect((await pay(ana, id, { resultado: "RECHAZADO" })).status).toBe(201);
    expect((await pay(ana, id, { concepto: "SALDO" })).status).toBe(201);
    const after = await orderOf(id);
    expect(after).toMatchObject({ estado: "CONFIRMADO", venceEn: before.venceEn, retenciones: [] });
    expect((await approved(id, "SALDO")).map((payment) => payment.importeCentavos)).toEqual([800000]);

    expect(await (await pay(ana, id)).json()).toMatchObject({ codigo: "SALDO_YA_PAGADO" });
  });

  it("dos pagos simultáneos del saldo: uno solo se aprueba", async () => {
    const id = await acceptedOrder(ana);
    await pay(ana, id);
    const statuses = (await Promise.all([pay(ana, id), pay(ana, id)])).map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await approved(id, "SALDO")).toHaveLength(1);
  });

  it("con envío: el saldo incluye el envío y no se paga en efectivo (D-48, RN-13)", async () => {
    const id = await acceptedOrder(ana, { envio: 30000 });
    await pay(ana, id);
    expect(await (await cash(id)).json()).toMatchObject({ codigo: "PEDIDO_NO_PAGABLE" });
    await pay(ana, id);
    expect((await approved(id, "SALDO"))[0]).toMatchObject({ importeCentavos: 830000 });
  });

  it("en efectivo, solo al retirar (T-106)", async () => {
    const id = await acceptedOrder(ana);
    await pay(ana, id);
    expect(await (await cash(id)).json()).toMatchObject({ codigo: "PEDIDO_NO_PAGABLE" });

    // INC-12 hará esta transición; acá se prepara el estado directamente.
    await db().pedido.update({ where: { id }, data: { estado: "LISTO_PARA_RETIRO" } });
    expect(await transition(id, "LISTO_PARA_RETIRO", "ENTREGADO").catch((error) => error)).toMatchObject({ code: "SALDO_PENDIENTE" });
    expect((await cash(id)).status).toBe(201);
    expect((await approved(id, "SALDO"))[0]).toMatchObject({ medio: "EFECTIVO", importeCentavos: 800000 });
    expect(await transition(id, "LISTO_PARA_RETIRO", "ENTREGADO")).toBe(true);
  });

  it("la base impide un segundo pago aprobado del mismo concepto", async () => {
    const id = await acceptedOrder(ana);
    await pay(ana, id);
    await expect(
      db().pago.create({ data: { pedidoId: id, concepto: "SENA", medio: "EFECTIVO", simulado: false, estado: "APROBADO", importeCentavos: 200000 } }),
    ).rejects.toThrow();
  });
});

describe("guarda del saldo pendiente (T-90)", () => {
  it("no se despacha con saldo pendiente; con el saldo pagado, sí", async () => {
    const id = await acceptedOrder(ana, { envio: 30000 });
    await pay(ana, id);
    await approvedDesign(id);
    expect(await transition(id, "CONFIRMADO", "DESPACHADO").catch((error) => error)).toMatchObject({ code: "SALDO_PENDIENTE", status: 409 });
    expect((await orderOf(id)).estado).toBe("CONFIRMADO");
    await pay(ana, id);
    expect(await transition(id, "CONFIRMADO", "DESPACHADO")).toBe(true);
  });
});

describe("seña de $0 con envío", () => {
  it("si el cupón cubre los productos, se confirma sin pago y el envío queda como saldo, exigido antes del despacho", async () => {
    const cupon = await couponFor(ana, 1500000); // cupón de $1.500
    const id = await acceptedOrder(ana, { envio: 30000, cupon, precio: 50000 }); // productos $1.000
    const order = await orderOf(id);
    expect(order).toMatchObject({ estado: "CONFIRMADO", senaCentavos: 0, totalCentavos: 30000, venceEn: null, pagos: [], retenciones: [] });
    expect(order.historial.at(-1)).toMatchObject({ estadoNuevo: "CONFIRMADO", motivo: "SIN_SENA_REQUERIDA" });
    await approvedDesign(id);

    expect(await transition(id, "CONFIRMADO", "DESPACHADO").catch((error) => error)).toMatchObject({ code: "SALDO_PENDIENTE" });
    expect((await pay(ana, id)).status).toBe(201);
    expect((await approved(id, "SALDO"))[0]).toMatchObject({ importeCentavos: 30000 });
    expect(await transition(id, "CONFIRMADO", "DESPACHADO")).toBe(true);
  });
});

describe("cancelación con pagos reales (RN-21, RN-24)", () => {
  async function cancelAsClient(id: string) {
    const preview = await (
      await cancelPreviewRoute(apiRequest(`/api/orders/${id}/cancellation-preview`, { method: "GET", cookie: ana.cookie }), params({ id }))
    ).json();
    const response = await cancelRoute(
      apiRequest(`/api/orders/${id}/cancel`, {
        cookie: ana.cookie,
        body: {
          motivo: "Me arrepentí",
          cargoEsperadoCentavos: preview.desglose.cargoCentavos,
          aReembolsarEsperadoCentavos: preview.desglose.aReembolsarCentavos,
        },
      }),
      params({ id }),
    );
    expect(response.status).toBe(200);
    const stored = await db().cancelacion.findUniqueOrThrow({ where: { pedidoId: id } });
    // T-111: la vista previa muestra la misma regla y el mismo desglose que se guardan.
    expect(stored).toMatchObject({ regla: preview.regla, ...preview.desglose });
    return { stored, refunds: await db().reembolso.findMany({ where: { pedidoId: id }, include: { pago: true } }) };
  }
  const insideWindow = (id: string) =>
    db().pedido.update({
      where: { id },
      data: { inicioVentanaCargo: new Date(Date.now() - HOUR), fechaDespachoComprometida: new Date(Date.now() + 47 * HOUR) },
    });

  it("dentro de la ventana, solo con la seña: se retiene completa, sin reembolso ni cargo del 15 % (T-91, T-99)", async () => {
    const id = await acceptedOrder(ana);
    await pay(ana, id);
    await insideWindow(id);
    const { stored, refunds } = await cancelAsClient(id);
    expect(stored).toMatchObject({ regla: "RN_21", cargoCentavos: 200000, aReembolsarCentavos: 0 });
    expect(refunds).toHaveLength(0);
    expect(await db().ajusteEconomico.findMany({ where: { pedidoId: id } })).toEqual([
      expect.objectContaining({ tipo: "RETENCION_SENA", importeCentavos: 200000 }),
    ]);
  });

  it("dentro de la ventana, con seña y saldo: se retiene la seña y se devuelve el saldo (T-109)", async () => {
    const id = await acceptedOrder(ana);
    await pay(ana, id);
    await pay(ana, id);
    await insideWindow(id);
    const { stored, refunds } = await cancelAsClient(id);
    expect(stored).toMatchObject({ regla: "RN_21", cargoCentavos: 200000, aReembolsarCentavos: 800000 });
    expect(refunds.map((refund) => [refund.pago.concepto, refund.importeCentavos])).toEqual([["SALDO", 800000]]);
  });

  it("fuera de la ventana: se devuelve todo, seña y saldo, sin cargo (T-92, T-100)", async () => {
    const id = await acceptedOrder(ana);
    await pay(ana, id);
    await pay(ana, id);
    const { stored, refunds } = await cancelAsClient(id);
    expect(stored).toMatchObject({ regla: "SIN_CARGO", cargoCentavos: 0, aReembolsarCentavos: 1000000 });
    expect(refunds.map((refund) => [refund.pago.concepto, refund.importeCentavos]).sort()).toEqual([
      ["SALDO", 800000],
      ["SENA", 200000],
    ]);
  });

  it("la tienda cancela un personalizado con seña: devuelve la seña y emite el cupón (T-93)", async () => {
    const id = await acceptedOrder(ana);
    await pay(ana, id);
    await insideWindow(id);
    expect(
      (await storeCancelRoute(apiRequest(`/api/admin/orders/${id}/cancel`, { cookie: admin.cookie, body: { motivo: "Sin lona" } }), params({ id })))
        .status,
    ).toBe(200);
    expect(await db().reembolso.findMany({ where: { pedidoId: id } })).toEqual([expect.objectContaining({ importeCentavos: 200000 })]);
    expect(await db().cupon.findUniqueOrThrow({ where: { pedidoOrigenId: id } })).toMatchObject({ montoCentavos: 100000 });
  });
});
