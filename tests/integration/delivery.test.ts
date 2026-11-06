import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as adjustmentsRoute } from "@/app/api/admin/orders/[id]/adjustments/route";
import { POST as receiptsRoute } from "@/app/api/admin/orders/[id]/receipts/route";
import { POST as transitionsRoute } from "@/app/api/admin/orders/[id]/transitions/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { GET as fileUrlRoute } from "@/app/api/files/[id]/url/route";
import { POST as uploadRoute } from "@/app/api/files/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

// INC-12: solo lo que se puede romper. Stock al despachar y entregar, despacho doble, tope de la
// compensación por demora (también con dos cargas a la vez) y acceso al PDF de un comprobante.

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

async function variant(stock = 5) {
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const created = await createVariant(actor, product.id, { precioCentavos: 150000 });
  await registerVariantMovement(actor, created.id, { tipo: "INGRESO", cantidad: stock });
  return created.id;
}

/** Pedido estándar pagado online. Con `envio`, se pasa a envío en la base: el flujo de la cotización del envío no es lo que se prueba acá. */
async function paidOrder(user: Account, varianteId: string, envio = false) {
  await addItemRoute(apiRequest("/api/cart/items", { cookie: user.cookie, body: { varianteId, cantidad: 1 } }));
  const response = await checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ modalidadCierre: "ONLINE", modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: 150000 }] }),
    }),
  );
  expect(response.status).toBe(201);
  const id = (await response.json()).pedido.id as string;
  const paid = await payRoute(
    apiRequest(`/api/payments/simulated/${id}`, { cookie: user.cookie, body: { resultado: "APROBADO" } }),
    params({ orderId: id }),
  );
  expect(paid.status).toBe(201);
  if (envio) await db().pedido.update({ where: { id }, data: { modalidadEntrega: "ENVIO" } });
  return id;
}

const transition = (admin: Account, id: string, body: object) =>
  transitionsRoute(apiRequest(`/api/admin/orders/${id}/transitions`, { cookie: admin.cookie, body }), params({ id }));

const compensate = (admin: Account, id: string, importeCentavos: number) =>
  adjustmentsRoute(
    apiRequest(`/api/admin/orders/${id}/adjustments`, {
      cookie: admin.cookie,
      body: { importeCentavos, justificacion: "Llegó tarde", autorizadoPor: "Dueña" },
    }),
    params({ id }),
  );

const stock = (id: string) => db().variante.findUniqueOrThrow({ where: { id }, select: { stockFisico: true, stockReservado: true } });

let admin: Account;
let client: Account;

beforeEach(async () => {
  await resetDatabase();
  admin = await account("admin@ejemplo.com", true);
  client = await account("cliente@ejemplo.com");
});

afterAll(() => resetDatabase());

describe("entregas: stock", () => {
  it("en el retiro, las unidades salen del stock físico recién al entregar", async () => {
    const varianteId = await variant(5);
    const id = await paidOrder(client, varianteId);
    expect(await stock(varianteId)).toEqual({ stockFisico: 5, stockReservado: 1 });

    expect((await transition(admin, id, { estado: "LISTO_PARA_RETIRO" })).status).toBe(200);
    expect(await stock(varianteId)).toEqual({ stockFisico: 5, stockReservado: 1 });

    expect((await transition(admin, id, { estado: "ENTREGADO" })).status).toBe(200);
    expect(await stock(varianteId)).toEqual({ stockFisico: 4, stockReservado: 0 });
    expect((await db().entrega.findUniqueOrThrow({ where: { pedidoId: id } })).entregadoPorId).toBe(admin.id);
  });

  it("dos despachos simultáneos: uno solo avanza y el stock se consume una vez", async () => {
    const varianteId = await variant(5);
    const id = await paidOrder(client, varianteId, true);
    const results = await Promise.all([
      transition(admin, id, { estado: "DESPACHADO", transportista: "Correo", codigoSeguimiento: "AB123" }),
      transition(admin, id, { estado: "DESPACHADO" }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await stock(varianteId)).toEqual({ stockFisico: 4, stockReservado: 0 });

    // Entregar después del despacho no vuelve a descontar.
    expect((await transition(admin, id, { estado: "ENTREGADO" })).status).toBe(200);
    expect(await stock(varianteId)).toEqual({ stockFisico: 4, stockReservado: 0 });
  });
});

describe("compensación por demora", () => {
  async function dispatchWithDate(offsetMs: number) {
    const id = await paidOrder(client, await variant(5), true);
    await db().pedido.update({ where: { id }, data: { fechaDespachoComprometida: new Date(Date.now() + offsetMs) } });
    expect((await transition(admin, id, { estado: "DESPACHADO" })).status).toBe(200);
    return id;
  }

  it("sin demora se rechaza", async () => {
    const id = await dispatchWithDate(3_600_000);
    expect((await (await compensate(admin, id, 1000)).json()).codigo).toBe("SIN_DEMORA");
  });

  it("no supera lo pagado que no se devolvió y genera su reembolso", async () => {
    const id = await dispatchWithDate(-3_600_000);
    const tooMuch = await compensate(admin, id, 150001);
    expect(tooMuch.status).toBe(422);
    expect((await tooMuch.json()).codigo).toBe("IMPORTE_EXCEDE_PAGADO");

    expect((await compensate(admin, id, 100000)).status).toBe(201);
    const refunds = await db().reembolso.findMany({ where: { pedidoId: id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ importeCentavos: 100000, estado: "PENDIENTE" });
    expect(refunds[0]!.ajusteId).not.toBeNull();

    // Quedan $500: una segunda de $600 se rechaza.
    expect((await compensate(admin, id, 60000)).status).toBe(422);
  });

  it("dos cargas simultáneas no devuelven más de lo pagado", async () => {
    const id = await dispatchWithDate(-3_600_000);
    const results = await Promise.all([compensate(admin, id, 100000), compensate(admin, id, 100000)]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 422]);
    const { _sum } = await db().reembolso.aggregate({ where: { pedidoId: id }, _sum: { importeCentavos: true } });
    expect(_sum.importeCentavos).toBe(100000);
  });
});

describe("comprobantes", () => {
  it("el PDF lo descarga el dueño del pedido y nadie más; el número no se repite", async () => {
    const id = await paidOrder(client, await variant(5));
    const form = new FormData();
    form.set("archivo", new File([new TextEncoder().encode("%PDF-1.7\n factura")], "factura.pdf", { type: "application/pdf" }));
    form.set("contexto", "COMPROBANTE");
    const uploaded = await uploadRoute(
      new Request(`${APP_URL}/api/files`, { method: "POST", headers: { origin: APP_URL, cookie: admin.cookie }, body: form }),
    );
    expect(uploaded.status).toBe(201);
    const archivoId = (await uploaded.json()).archivo.id as string;

    const body = { tipo: "FACTURA", letra: "c", puntoVenta: 1, numero: 25, fechaEmision: "2026-11-05", importeCentavos: 150000, archivoId };
    const receipt = (payload: object) =>
      receiptsRoute(apiRequest(`/api/admin/orders/${id}/receipts`, { cookie: admin.cookie, body: payload }), params({ id }));
    expect((await receipt(body)).status).toBe(201);
    expect((await (await receipt({ ...body, archivoId: undefined })).json()).codigo).toBe("COMPROBANTE_DUPLICADO");

    const url = (user: Account) =>
      fileUrlRoute(apiRequest(`/api/files/${archivoId}/url`, { method: "GET", cookie: user.cookie }), params({ id: archivoId }));
    expect((await url(client)).status).toBe(200);
    expect((await url(await account("otra@ejemplo.com"))).status).toBe(404);
  });
});
