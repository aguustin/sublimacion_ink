import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as quoteRoute } from "@/app/api/admin/custom-orders/[id]/quote/route";
import { POST as reissueRoute } from "@/app/api/admin/custom-orders/[id]/reissue-quote/route";
import { POST as storeCancelRoute } from "@/app/api/admin/orders/[id]/cancel/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as acceptRoute } from "@/app/api/custom-orders/[id]/quote/accept/route";
import { GET as previewRoute } from "@/app/api/custom-orders/[id]/quote/preview/route";
import { POST as rejectRoute } from "@/app/api/custom-orders/[id]/quote/reject/route";
import { POST as requestRoute } from "@/app/api/custom-orders/route";
import { DELETE as deleteFileRoute } from "@/app/api/files/[id]/route";
import { GET as fileUrlRoute } from "@/app/api/files/[id]/url/route";
import { POST as uploadRoute } from "@/app/api/files/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { clearMemoryObjects } from "@/server/modules/files/storage";
import { expireCashReservations, expireOnlinePayments } from "@/server/modules/orders/expiration.service";
import { reservationExpiry } from "@/server/modules/orders/reservation.policy";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const db = () => getDb();
const TZ = "America/Argentina/Buenos_Aires";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Account = { id: string; cookie: string };

async function account(email: string, { admin = false, telefono = true } = {}): Promise<Account> {
  const response = await register(
    apiRequest("/api/auth/register", {
      body: { nombre: "Persona", email, contrasena: "clave-segura-1", ...(telefono && { telefono: "1155551234" }) },
    }),
  );
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

async function customVariant() {
  const actor = { id: admin.id };
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Cartel", categoriaId: category.id, tipo: "PERSONALIZABLE" });
  return (await createVariant(actor, product.id, { material: "Lona", medida: "90 x 90 cm" })).id;
}

async function reference(user: Account) {
  const form = new FormData();
  form.set("archivo", new File([PNG], "boceto.png"));
  form.set("contexto", "REFERENCIA");
  const response = await uploadRoute(
    new Request(`${APP_URL}/api/files`, { method: "POST", headers: { origin: APP_URL, cookie: user.cookie }, body: form }),
  );
  return (await response.json()).archivo.id as string;
}

function request(user: Account, body: Record<string, unknown>) {
  return requestRoute(
    new Request(`${APP_URL}/api/custom-orders`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
  );
}

async function customOrder(user: Account, extra: Record<string, unknown> = {}) {
  const varianteId = await customVariant();
  const response = await request(user, {
    varianteId,
    cantidad: 2,
    descripcion: "Cartel con el logo del local",
    fechaDeseada: "2026-12-01",
    modalidadEntrega: "RETIRO",
    ...extra,
  });
  expect(response.status).toBe(201);
  return (await response.json()).pedido.id as string;
}

const quote = async (id: string, body: Record<string, unknown> = {}) => {
  const response = await quoteRoute(
    apiRequest(`/api/admin/custom-orders/${id}/quote`, {
      cookie: admin.cookie,
      body: { precioUnitarioCentavos: 500000, fechaEntregaPropuesta: "2026-12-10", detalle: "Impresión en lona con ojales", ...body },
    }),
    params({ id }),
  );
  return { status: response.status, id: (await response.json()).cotizacion?.id as string };
};
const accept = (user: Account, id: string, body: Record<string, unknown>) =>
  acceptRoute(apiRequest(`/api/custom-orders/${id}/quote/accept`, { cookie: user.cookie, body }), params({ id }));
const orderOf = (id: string) =>
  db().pedido.findUniqueOrThrow({ where: { id }, include: { items: true, retenciones: true, cotizaciones: true, referencias: true } });

let admin: Account;
let ana: Account;

beforeEach(async () => {
  await resetDatabase();
  clearMemoryObjects();
  admin = await account("admin@tienda.ejemplo", { admin: true });
  ana = await account("ana@ejemplo.com");
});
afterAll(async () => {
  await db().$disconnect();
});

describe("solicitud de personalización (RF-22)", () => {
  it("crea el pedido en definición, sin stock, plazo ni ítems, con la solicitud y las referencias", async () => {
    const referencia = await reference(ana);
    const id = await customOrder(ana, { referencias: [referencia] });

    const order = await orderOf(id);
    expect(order).toMatchObject({ tipo: "PERSONALIZADO", estado: "EN_DEFINICION", venceEn: null, items: [], retenciones: [], totalCentavos: 0 });
    expect(order.referencias.map((entry) => entry.archivoId)).toEqual([referencia]);
    expect(await db().solicitudPersonalizacion.findUniqueOrThrow({ where: { pedidoId: id } })).toMatchObject({ cantidad: 2 });
  });

  it("no acepta referencias ajenas ni productos estándar", async () => {
    const bruno = await account("bruno@ejemplo.com");
    const ajena = await reference(bruno);
    const varianteId = await customVariant();
    const base = { varianteId, cantidad: 1, descripcion: "Un cartel grande", fechaDeseada: "2026-12-01", modalidadEntrega: "RETIRO" };
    expect((await request(ana, { ...base, referencias: [ajena] })).status).toBe(404);

    const category = await createCategory({ id: admin.id }, { nombre: "Tazas" });
    const standard = await createProduct({ id: admin.id }, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
    const standardVariant = (await createVariant({ id: admin.id }, standard.id, { precioCentavos: 1000 })).id;
    expect(await (await request(ana, { ...base, varianteId: standardVariant })).json()).toMatchObject({ codigo: "PRODUCTO_NO_DISPONIBLE" });
    expect(await db().pedido.count()).toBe(0);
  });

  it("la referencia la ven el cliente y el admin, no otro cliente, y no se puede borrar mientras está en un pedido", async () => {
    const referencia = await reference(ana);
    await customOrder(ana, { referencias: [referencia] });
    const bruno = await account("bruno@ejemplo.com");
    const url = (user: Account) =>
      fileUrlRoute(apiRequest(`/api/files/${referencia}/url`, { method: "GET", cookie: user.cookie }), params({ id: referencia }));

    expect((await url(ana)).status).toBe(200);
    expect((await url(admin)).status).toBe(200);
    expect((await url(bruno)).status).toBe(404);
    const removal = await deleteFileRoute(
      apiRequest(`/api/files/${referencia}`, { method: "DELETE", cookie: ana.cookie }),
      params({ id: referencia }),
    );
    expect(await removal.json()).toMatchObject({ codigo: "ARCHIVO_EN_USO" });
  });
});

describe("cotización (D-10) y respuesta del cliente", () => {
  it("una cotización nueva reemplaza la vigente; aceptar la vieja se rechaza; el rechazo deja el pedido en definición (RN-17)", async () => {
    const id = await customOrder(ana);
    expect((await quoteRoute(apiRequest(`/api/admin/custom-orders/${id}/quote`, { cookie: ana.cookie, body: {} }), params({ id }))).status).toBe(403);
    const first = await quote(id);
    const second = await quote(id, { precioUnitarioCentavos: 450000 });

    const stale = await accept(ana, id, { cotizacionId: first.id, modalidadCierre: "ONLINE", totalEsperadoCentavos: 1000000 });
    expect(await stale.json()).toMatchObject({ codigo: "COTIZACION_DESACTUALIZADA" });

    expect(
      (
        await rejectRoute(
          apiRequest(`/api/custom-orders/${id}/quote/reject`, { cookie: ana.cookie, body: { cotizacionId: second.id } }),
          params({ id }),
        )
      ).status,
    ).toBe(204);
    const order = await orderOf(id);
    expect(order).toMatchObject({ estado: "EN_DEFINICION", venceEn: null });
    expect(Object.fromEntries(order.cotizaciones.map((entry) => [entry.id, entry.estado]))).toEqual({
      [first.id]: "REEMPLAZADA",
      [second.id]: "RECHAZADA",
    });

    // Después de rechazar, la tienda puede volver a cotizar.
    expect((await quote(id, { precioUnitarioCentavos: 400000 })).status).toBe(201);
  });

  it("aceptar online: pago pendiente de 30 min, seña del 20 % de los productos después del cupón y sin envío", async () => {
    const id = await customOrder(ana);
    const cotizacionId = (await quote(id)).id;
    const preview = await (
      await previewRoute(apiRequest(`/api/custom-orders/${id}/quote/preview`, { method: "GET", cookie: ana.cookie }), params({ id }))
    ).json();
    expect(preview).toMatchObject({ cotizacionId, precioProductosCentavos: 1000000, totalCentavos: 1000000, senaCentavos: 200000 });

    const before = Date.now();
    expect((await accept(ana, id, { cotizacionId, modalidadCierre: "ONLINE", totalEsperadoCentavos: 1000000 })).status).toBe(200);
    const order = await orderOf(id);
    expect(order).toMatchObject({
      estado: "PENDIENTE_PAGO",
      subtotalProductosCentavos: 1000000,
      totalCentavos: 1000000,
      porcentajeSena: 20,
      senaCentavos: 200000,
    });
    expect(order.items).toEqual([expect.objectContaining({ precioUnitarioCentavos: 500000, cantidad: 2 })]);
    expect(order.venceEn!.getTime() - before).toBeGreaterThanOrEqual(30 * 60_000);
    expect(order.venceEn!.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect(order.retenciones).toHaveLength(0);
    expect(order.cotizaciones[0]).toMatchObject({ estado: "ACEPTADA", respondidaPorId: ana.id });

    const pay = await payRoute(
      apiRequest(`/api/payments/simulated/${id}`, { cookie: ana.cookie, body: { resultado: "APROBADO" } }),
      params({ orderId: id }),
    );
    // INC-08.2: se cobra la seña, no el total.
    expect((await pay.json()).pago).toMatchObject({ concepto: "SENA", importeCentavos: 200000, estado: "APROBADO" });
  });

  it("aceptar en efectivo con retiro: reserva de 24 h hábiles desde la aceptación; antes, sin vencimiento (T-78)", async () => {
    const id = await customOrder(ana);
    const cotizacionId = (await quote(id)).id;
    expect((await orderOf(id)).venceEn).toBeNull();

    const start = new Date();
    expect((await accept(ana, id, { cotizacionId, modalidadCierre: "EFECTIVO", totalEsperadoCentavos: 1000000 })).status).toBe(200);
    const end = new Date();
    const order = await orderOf(id);
    expect(order.estado).toBe("RESERVADO");
    expect(order.venceEn!.getTime()).toBeGreaterThanOrEqual(reservationExpiry(start, new Set(), TZ).getTime());
    expect(order.venceEn!.getTime()).toBeLessThanOrEqual(reservationExpiry(end, new Set(), TZ).getTime());
  });

  it("con envío: la cotización exige el costo del envío, que suma al total pero no a la seña, y no admite efectivo (D-48, RN-13)", async () => {
    const direccion = await db().direccion.create({
      data: { usuarioId: ana.id, calle: "Calle 1", ciudad: "Rosario", provincia: "Santa Fe", codigoPostal: "2000" },
    });
    const id = await customOrder(ana, { modalidadEntrega: "ENVIO", direccionId: direccion.id });
    expect((await quote(id)).status).toBe(422);
    const cotizacionId = (await quote(id, { costoEnvioCentavos: 30000 })).id;

    expect(await (await accept(ana, id, { cotizacionId, modalidadCierre: "EFECTIVO", totalEsperadoCentavos: 1030000 })).json()).toMatchObject({
      codigo: "EFECTIVO_SOLO_RETIRO",
    });
    expect((await accept(ana, id, { cotizacionId, modalidadCierre: "ONLINE", totalEsperadoCentavos: 1030000 })).status).toBe(200);
    expect(await orderOf(id)).toMatchObject({ totalCentavos: 1030000, costoEnvioCentavos: 30000, senaCentavos: 200000 });
  });

  it("dos aceptaciones simultáneas: una sola tiene efecto", async () => {
    const id = await customOrder(ana);
    const cotizacionId = (await quote(id)).id;
    const body = { cotizacionId, modalidadCierre: "ONLINE", totalEsperadoCentavos: 1000000 };
    const statuses = (await Promise.all([accept(ana, id, body), accept(ana, id, body)])).map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect((await orderOf(id)).items).toHaveLength(1);
  });
});

describe("reemisión de una cotización vencida (D-42, T-110)", () => {
  it("el original queda vencido; el nuevo nace en definición, vinculado, con la solicitud, las referencias y una cotización nueva", async () => {
    const referencia = await reference(ana);
    const id = await customOrder(ana, { referencias: [referencia] });
    const cotizacionId = (await quote(id)).id;
    await accept(ana, id, { cotizacionId, modalidadCierre: "ONLINE", totalEsperadoCentavos: 1000000 });
    await db().pedido.update({ where: { id }, data: { venceEn: new Date(Date.now() - 1000) } });
    await expireOnlinePayments();
    expect((await orderOf(id)).estado).toBe("VENCIDO");

    const reissue = () =>
      reissueRoute(
        apiRequest(`/api/admin/custom-orders/${id}/reissue-quote`, {
          cookie: admin.cookie,
          body: { precioUnitarioCentavos: 520000, fechaEntregaPropuesta: "2026-12-20", detalle: "Nueva cotización" },
        }),
        params({ id }),
      );
    const response = await reissue();
    expect(response.status).toBe(201);
    const { pedidoId } = await response.json();
    expect((await reissue()).status).toBe(409);

    const original = await orderOf(id);
    const renewed = await orderOf(pedidoId);
    expect(original.estado).toBe("VENCIDO");
    expect(renewed).toMatchObject({ tipo: "PERSONALIZADO", estado: "EN_DEFINICION", pedidoOrigenId: id, venceEn: null, items: [] });
    expect(renewed.referencias.map((entry) => entry.archivoId)).toEqual([referencia]);
    expect(renewed.cotizaciones).toEqual([expect.objectContaining({ estado: "PROPUESTA", precioProductosCentavos: 1040000 })]);

    // El plazo empieza recién al aceptar la nueva cotización (RN-17).
    expect(
      (await accept(ana, pedidoId, { cotizacionId: renewed.cotizaciones[0]!.id, modalidadCierre: "EFECTIVO", totalEsperadoCentavos: 1040000 }))
        .status,
    ).toBe(200);
    expect((await orderOf(pedidoId)).venceEn).not.toBeNull();
    await expireCashReservations();
    expect((await orderOf(pedidoId)).estado).toBe("RESERVADO");
  });

  it("no se reemite un pedido que no venció por falta de seña", async () => {
    const id = await customOrder(ana);
    const response = await reissueRoute(
      apiRequest(`/api/admin/custom-orders/${id}/reissue-quote`, {
        cookie: admin.cookie,
        body: { precioUnitarioCentavos: 1, fechaEntregaPropuesta: "2026-12-20", detalle: "Nada" },
      }),
      params({ id }),
    );
    expect(await response.json()).toMatchObject({ codigo: "REEMISION_NO_PERMITIDA" });
  });

  it("la tienda puede cancelar una solicitud sin cotizar: sin cargo y sin cupón de $0", async () => {
    const id = await customOrder(ana);
    expect(
      (
        await storeCancelRoute(
          apiRequest(`/api/admin/orders/${id}/cancel`, { cookie: admin.cookie, body: { motivo: "No lo hacemos" } }),
          params({ id }),
        )
      ).status,
    ).toBe(200);
    expect((await orderOf(id)).estado).toBe("CANCELADO");
    expect(await db().cupon.count()).toBe(0);
  });
});
