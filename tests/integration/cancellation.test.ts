import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as closeAdjustmentRoute } from "@/app/api/admin/adjustments/[id]/close/route";
import { PATCH as adjustmentRoute } from "@/app/api/admin/adjustments/[id]/route";
import { POST as storeCancelRoute } from "@/app/api/admin/orders/[id]/cancel/route";
import { POST as cashPaymentRoute } from "@/app/api/admin/orders/[id]/cash-payment/route";
import { POST as closeRefundRoute } from "@/app/api/admin/refunds/[id]/close/route";
import { POST as executeRefundRoute } from "@/app/api/admin/refunds/[id]/execute/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { POST as cancelRoute } from "@/app/api/orders/[id]/cancel/route";
import { GET as previewRoute } from "@/app/api/orders/[id]/cancellation-preview/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { expireCashReservations } from "@/server/modules/orders/expiration.service";
import { updateStoreSettings } from "@/server/modules/store-settings/store-settings.service";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
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

async function variant(stock = 5) {
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const created = await createVariant(actor, product.id, { precioCentavos: 150000 });
  await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: stock });
  return created.id;
}

async function order(user: Account, varianteId: string, modalidadCierre: "ONLINE" | "EFECTIVO" = "ONLINE") {
  await addItemRoute(apiRequest("/api/cart/items", { cookie: user.cookie, body: { varianteId, cantidad: 1 } }));
  const response = await checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ modalidadCierre, modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: 150000 }] }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).pedido.id as string;
}

const pay = (user: Account, id: string) =>
  payRoute(apiRequest(`/api/payments/simulated/${id}`, { cookie: user.cookie, body: { resultado: "APROBADO" } }), params({ orderId: id }));

/** Pedido confirmado y pagado online; `windowStartsIn` < 0 lo deja dentro de la ventana de 48 h. */
async function paidOrder(user: Account, varianteId: string, windowStartsIn: number | null = null) {
  const id = await order(user, varianteId);
  expect((await pay(user, id)).status).toBe(201);
  if (windowStartsIn !== null) await setWindow(id, windowStartsIn);
  return id;
}

/** La fecha comprometida la fija el admin (INC-05.3); acá solo importa desde cuándo hay cargo. */
const setWindow = (id: string, hoursFromNow: number) =>
  db().pedido.update({
    where: { id },
    data: {
      fechaDespachoComprometida: new Date(Date.now() + (hoursFromNow + 48) * HOUR),
      inicioVentanaCargo: new Date(Date.now() + hoursFromNow * HOUR),
    },
  });

const preview = async (user: Account, id: string) =>
  (await previewRoute(apiRequest(`/api/orders/${id}/cancellation-preview`, { method: "GET", cookie: user.cookie }), params({ id }))).json();

async function cancel(user: Account, id: string, motivo = "Ya no lo necesito") {
  const { desglose } = await preview(user, id);
  return cancelRoute(
    apiRequest(`/api/orders/${id}/cancel`, {
      cookie: user.cookie,
      body: { motivo, cargoEsperadoCentavos: desglose.cargoCentavos, aReembolsarEsperadoCentavos: desglose.aReembolsarCentavos },
    }),
    params({ id }),
  );
}

const storeCancel = (cookie: string, id: string, body: unknown) =>
  storeCancelRoute(apiRequest(`/api/admin/orders/${id}/cancel`, { cookie, body }), params({ id }));
const reservedOf = async (id: string) => (await db().variante.findUniqueOrThrow({ where: { id } })).stockReservado;
const full = (id: string) =>
  db().pedido.findUniqueOrThrow({
    where: { id },
    include: { cancelacion: true, ajustes: true, reembolsos: true, retenciones: true, historial: true },
  });

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

describe("cancelación por el cliente (F-04)", () => {
  it("antes de pagar: sin cargo, libera el stock y el pago posterior se rechaza (RN-23)", async () => {
    const varianteId = await variant();
    const id = await order(ana, varianteId);
    expect(await preview(ana, id)).toMatchObject({ regla: "SIN_CARGO", desglose: { cargoCentavos: 0, aReembolsarCentavos: 0 } });

    expect((await cancel(ana, id)).status).toBe(200);

    const cancelled = await full(id);
    expect(cancelled).toMatchObject({ estado: "CANCELADO", ajustes: [], reembolsos: [] });
    expect(cancelled.cancelacion).toMatchObject({
      rol: "CLIENTE",
      solicitadaPorId: ana.id,
      estadoPrevio: "PENDIENTE_PAGO",
      motivo: "Ya no lo necesito",
    });
    expect(cancelled.retenciones.map((retention) => retention.estado)).toEqual(["LIBERADA"]);
    expect(await reservedOf(varianteId)).toBe(0);
    expect((await pay(ana, id)).status).toBe(409);
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "PEDIDO_CANCELADO" } })).toBe(1);
  });

  it("dentro de la ventana: cargo del 15 %, reembolso simulado del resto y costo real precargado (T-31, T-108)", async () => {
    const varianteId = await variant();
    const id = await paidOrder(ana, varianteId, -1);

    expect((await cancel(ana, id)).status).toBe(200);

    const cancelled = await full(id);
    expect(cancelled.cancelacion).toMatchObject({
      regla: "RN_15",
      dentroVentana: true,
      productosCobradosCentavos: 150000,
      totalPagadoCentavos: 150000,
      porcentajeAplicado: 15,
      cargoCentavos: 22500,
      aReembolsarCentavos: 127500,
    });
    expect(cancelled.ajustes).toEqual([
      expect.objectContaining({ tipo: "CARGO_SERVICIO_CANCELACION", importeCentavos: 22500, estado: "REGISTRADO", costoRealEstimadoCentavos: 30000 }),
    ]);
    expect(cancelled.reembolsos).toEqual([expect.objectContaining({ importeCentavos: 127500, estado: "PENDIENTE", simulado: true })]);
    expect(await reservedOf(varianteId)).toBe(0);
  });

  it("fuera de la ventana o sin fecha: reembolso total, sin cargo (T-32, T-35, T-72)", async () => {
    const outside = await paidOrder(ana, await variant(), 1);
    const noDate = await paidOrder(ana, await variant());
    for (const id of [outside, noDate]) {
      expect((await cancel(ana, id)).status).toBe(200);
      const cancelled = await full(id);
      expect(cancelled.cancelacion).toMatchObject({ regla: "SIN_CARGO", cargoCentavos: 0, aReembolsarCentavos: 150000 });
      expect(cancelled.ajustes).toHaveLength(0);
      expect(cancelled.reembolsos).toEqual([expect.objectContaining({ importeCentavos: 150000, estado: "PENDIENTE" })]);
    }
  });

  it("si la ventana empieza entre la vista previa y la confirmación, se rechaza sin cambiar nada (T-111)", async () => {
    const id = await paidOrder(ana, await variant(), 1);
    const { desglose } = await preview(ana, id);
    await setWindow(id, -1);

    const response = await cancelRoute(
      apiRequest(`/api/orders/${id}/cancel`, {
        cookie: ana.cookie,
        body: { motivo: "Me arrepentí", cargoEsperadoCentavos: desglose.cargoCentavos, aReembolsarEsperadoCentavos: desglose.aReembolsarCentavos },
      }),
      params({ id }),
    );
    expect(await response.json()).toMatchObject({
      codigo: "CONDICIONES_CAMBIARON",
      detalles: { regla: "RN_15", desglose: { cargoCentavos: 22500 } },
    });
    expect((await full(id)).estado).toBe("CONFIRMADO");
  });

  it("listo para retirar: no se cancela desde la web y se indica el contacto; en producción, sí (RN-23, T-95)", async () => {
    await updateStoreSettings(actor, { emailContacto: "hola@tienda.ejemplo" });
    const ready = await paidOrder(ana, await variant());
    await db().pedido.update({ where: { id: ready }, data: { estado: "LISTO_PARA_RETIRO" } });
    const response = await previewRoute(
      apiRequest(`/api/orders/${ready}/cancellation-preview`, { method: "GET", cookie: ana.cookie }),
      params({ id: ready }),
    );
    expect(await response.json()).toMatchObject({
      codigo: "CANCELACION_NO_PERMITIDA",
      detalles: { contacto: { emailContacto: "hola@tienda.ejemplo" } },
    });

    const inProduction = await paidOrder(ana, await variant());
    await db().pedido.update({ where: { id: inProduction }, data: { estado: "EN_PRODUCCION" } });
    expect((await cancel(ana, inProduction)).status).toBe(200);
  });

  it("otro cliente no ve ni cancela el pedido", async () => {
    const id = await paidOrder(ana, await variant());
    const bruno = await account("bruno@ejemplo.com");
    const response = await cancelRoute(
      apiRequest(`/api/orders/${id}/cancel`, {
        cookie: bruno.cookie,
        body: { motivo: "Ajeno", cargoEsperadoCentavos: 0, aReembolsarEsperadoCentavos: 150000 },
      }),
      params({ id }),
    );
    expect(response.status).toBe(404);
  });

  it("pagado en efectivo: el cargo se descuenta y la devolución queda pendiente de arreglo hasta cerrarla con nota (RN-18, T-97)", async () => {
    const id = await order(ana, await variant(), "EFECTIVO");
    await cashPaymentRoute(apiRequest(`/api/admin/orders/${id}/cash-payment`, { cookie: admin.cookie }), params({ id }));
    await setWindow(id, -1);
    expect((await cancel(ana, id)).status).toBe(200);

    const [refund] = (await full(id)).reembolsos;
    expect(refund).toMatchObject({ importeCentavos: 127500, estado: "PENDIENTE_ARREGLO", simulado: false });
    expect(
      (await executeRefundRoute(apiRequest(`/api/admin/refunds/${refund!.id}/execute`, { cookie: admin.cookie }), params({ id: refund!.id }))).status,
    ).toBe(409);
    const close = (body: unknown) =>
      closeRefundRoute(apiRequest(`/api/admin/refunds/${refund!.id}/close`, { cookie: admin.cookie, body }), params({ id: refund!.id }));
    expect((await close({ nota: "" })).status).toBe(422);
    expect((await close({ nota: "Devuelto en el local" })).status).toBe(200);
    expect(await db().reembolso.findUniqueOrThrow({ where: { id: refund!.id } })).toMatchObject({
      estado: "DEVUELTO",
      notaCierre: "Devuelto en el local",
      cerradoPorId: admin.id,
    });
  });
});

describe("cancelación por la tienda (F-05, RN-19)", () => {
  it("sin cargo aun dentro de la ventana, devolución total, motivo obligatorio y cupón pendiente de INC-11 (T-33, T-76)", async () => {
    const varianteId = await variant();
    const id = await paidOrder(ana, varianteId, -1);
    expect((await storeCancel(ana.cookie, id, { motivo: "Sin insumos" })).status).toBe(403);
    expect((await storeCancel(admin.cookie, id, { motivo: "" })).status).toBe(422);

    expect((await storeCancel(admin.cookie, id, { motivo: "Sin insumos" })).status).toBe(200);

    const cancelled = await full(id);
    expect(cancelled.cancelacion).toMatchObject({
      rol: "TIENDA",
      solicitadaPorId: admin.id,
      estadoPrevio: "CONFIRMADO",
      motivo: "Sin insumos",
      regla: "RN_19",
      cargoCentavos: 0,
      aReembolsarCentavos: 150000,
    });
    expect(cancelled.ajustes).toHaveLength(0);
    expect(cancelled.historial.at(-1)).toMatchObject({ estadoNuevo: "CANCELADO", actorId: admin.id, motivo: "CANCELACION_TIENDA" });
    const audit = await db().eventoAuditoria.findFirstOrThrow({ where: { accion: "PEDIDO_CANCELADO", entidadId: id } });
    expect(audit.datos).toMatchObject({ rol: "TIENDA", cuponEmitidoId: expect.any(String) });
    expect(await db().cupon.findUniqueOrThrow({ where: { pedidoOrigenId: id } })).toMatchObject({ clienteId: ana.id, montoCentavos: 15000, estado: "ACTIVO" });
    expect(await reservedOf(varianteId)).toBe(0);
  });

  it("puede cancelar un pedido listo para retirar; no uno despachado", async () => {
    const ready = await paidOrder(ana, await variant());
    await db().pedido.update({ where: { id: ready }, data: { estado: "LISTO_PARA_RETIRO" } });
    expect((await storeCancel(admin.cookie, ready, { motivo: "Se dañó al terminarlo" })).status).toBe(200);

    const shipped = await paidOrder(ana, await variant());
    await db().pedido.update({ where: { id: shipped }, data: { estado: "DESPACHADO" } });
    expect(await (await storeCancel(admin.cookie, shipped, { motivo: "Tarde" })).json()).toMatchObject({ codigo: "ESTADO_INVALIDO" });
  });
});

describe("reembolsos, cargos y concurrencia", () => {
  it("el reembolso simulado se ejecuta una sola vez aunque se pida dos veces a la vez (RF-42)", async () => {
    const id = await paidOrder(ana, await variant());
    await cancel(ana, id);
    const [refund] = (await full(id)).reembolsos;
    const execute = () =>
      executeRefundRoute(apiRequest(`/api/admin/refunds/${refund!.id}/execute`, { cookie: admin.cookie }), params({ id: refund!.id }));

    const statuses = await Promise.all([execute(), execute()]).then((responses) => responses.map((response) => response.status).sort());
    expect(statuses).toEqual([200, 409]);
    expect(await db().reembolso.findUniqueOrThrow({ where: { id: refund!.id } })).toMatchObject({
      estado: "REALIZADO_SIMULADO",
      referenciaExterna: expect.stringMatching(/^SIM-REEMBOLSO-/),
    });
    expect(await db().eventoAuditoria.count({ where: { accion: "REEMBOLSO_EJECUTADO", entidadId: id } })).toBe(1);
  });

  it("costo real editable sin cambiar el cargo; un cargo pendiente se cierra con resultado y nota (RF-53, RN-18, T-75)", async () => {
    const id = await paidOrder(ana, await variant(), -1);
    await cancel(ana, id);
    const [charge] = (await full(id)).ajustes;

    const edit = await adjustmentRoute(
      apiRequest(`/api/admin/adjustments/${charge!.id}`, { method: "PATCH", cookie: admin.cookie, body: { costoRealEstimadoCentavos: 25000 } }),
      params({ id: charge!.id }),
    );
    expect(edit.status).toBe(200);
    expect(await db().ajusteEconomico.findUniqueOrThrow({ where: { id: charge!.id } })).toMatchObject({
      costoRealEstimadoCentavos: 25000,
      importeCentavos: 22500,
    });

    const close = (body: unknown) =>
      closeAdjustmentRoute(apiRequest(`/api/admin/adjustments/${charge!.id}/close`, { cookie: admin.cookie, body }), params({ id: charge!.id }));
    expect(await (await close({ resultado: "COBRADO", nota: "Ya descontado" })).json()).toMatchObject({ codigo: "AJUSTE_NO_PENDIENTE" });

    // Un cargo que lo pagado no cubre queda pendiente de arreglo (RN-18).
    await db().ajusteEconomico.update({ where: { id: charge!.id }, data: { estado: "PENDIENTE_ARREGLO" } });
    expect((await close({ resultado: "COBRADO", nota: "" })).status).toBe(422);
    expect((await close({ resultado: "CONDONADO", nota: "Cliente frecuente" })).status).toBe(200);
    expect(await db().ajusteEconomico.findUniqueOrThrow({ where: { id: charge!.id } })).toMatchObject({
      estado: "CONDONADO",
      cerradoPorId: admin.id,
    });
  });

  it("la base impide un segundo cargo de cancelación para el mismo pedido (RN-24, T-99)", async () => {
    const id = await paidOrder(ana, await variant(), -1);
    await cancel(ana, id);
    await expect(
      db().ajusteEconomico.create({ data: { pedidoId: id, tipo: "RETENCION_SENA", baseCentavos: 1, importeCentavos: 1, estado: "REGISTRADO" } }),
    ).rejects.toThrow();
  });

  it("dos cancelaciones simultáneas: una sola tiene efecto", async () => {
    const id = await paidOrder(ana, await variant(), -1);
    const statuses = await Promise.all([cancel(ana, id), storeCancel(admin.cookie, id, { motivo: "Sin insumos" })]).then((responses) =>
      responses.map((response) => response.status),
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(await db().cancelacion.count()).toBe(1);
    expect(await db().reembolso.count()).toBe(1);
  });

  it("cancelación y pago simultáneos: el estado final es coherente con el stock y los pagos (T-16)", async () => {
    const varianteId = await variant();
    const id = await order(ana, varianteId);
    const [cancelled] = await Promise.all([cancel(ana, id), pay(ana, id)]);

    const final = await full(id);
    const approved = await db().pago.count({ where: { pedidoId: id, estado: "APROBADO" } });
    if (cancelled.ok) {
      expect(final.estado).toBe("CANCELADO");
      expect(approved).toBe(0);
      expect(await reservedOf(varianteId)).toBe(0);
    } else {
      expect(final.estado).toBe("CONFIRMADO");
      expect(approved).toBe(1);
      expect(await reservedOf(varianteId)).toBe(1);
    }
  });

  it("una reserva cancelada no se vuelve a liberar cuando corre el vencimiento (T-17)", async () => {
    const varianteId = await variant();
    const id = await order(ana, varianteId, "EFECTIVO");
    await cancel(ana, id);
    await db().pedido.update({ where: { id }, data: { venceEn: new Date(Date.now() - 1000) } });

    expect(await expireCashReservations()).toEqual({ revisados: 0, vencidos: 0 });
    expect((await full(id)).estado).toBe("CANCELADO");
    expect(await reservedOf(varianteId)).toBe(0);
  });
});
