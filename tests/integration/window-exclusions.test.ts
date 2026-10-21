import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as removeRoute } from "@/app/api/admin/cancellation-window-exclusions/[fecha]/route";
import { POST as previewRoute } from "@/app/api/admin/cancellation-window-exclusions/preview/route";
import { POST as addRoute } from "@/app/api/admin/cancellation-window-exclusions/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { POST as cancelRoute } from "@/app/api/orders/[id]/cancel/route";
import { GET as cancelPreviewRoute } from "@/app/api/orders/[id]/cancellation-preview/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { setDispatchDate } from "@/server/modules/orders/dispatch-date.service";
import { localDate } from "@/server/shared/business-hours";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const db = () => getDb();
const TZ = "America/Argentina/Buenos_Aires";
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

/** Día local de Argentina a `days` días de hoy, como "AAAA-MM-DD". */
const day = (days: number) => localDate(new Date(Date.now() + days * 24 * HOUR), TZ);
/** Las 10:00 de Argentina de ese día. */
const tenAm = (date: string) => new Date(`${date}T10:00:00-03:00`);

/** Pedido estándar pagado, con la fecha comprometida a las 10:00 de dentro de `days` días. */
async function confirmedOrder(user: Account, days: number) {
  const actor = { id: admin.id };
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const varianteId = (await createVariant(actor, product.id, { precioCentavos: 100000 })).id;
  await registerVariantMovement(actor, varianteId, { tipo: "INGRESO", cantidad: 5 });
  await addItemRoute(apiRequest("/api/cart/items", { cookie: user.cookie, body: { varianteId, cantidad: 1 } }));
  const response = await checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ modalidadCierre: "ONLINE", modalidadEntrega: "RETIRO", precios: [{ varianteId, precioUnitarioCentavos: 100000 }] }),
    }),
  );
  const id = (await response.json()).pedido.id as string;
  await payRoute(apiRequest(`/api/payments/simulated/${id}`, { cookie: user.cookie, body: { resultado: "APROBADO" } }), params({ orderId: id }));
  await setDispatchDate({ id: admin.id }, id, { fecha: tenAm(day(days)).toISOString() });
  return id;
}

const add = (fecha: string, cookie = admin.cookie) =>
  addRoute(apiRequest("/api/admin/cancellation-window-exclusions", { cookie, body: { fecha, motivo: "Cierre por inventario" } }));
const remove = (fecha: string) =>
  removeRoute(apiRequest(`/api/admin/cancellation-window-exclusions/${fecha}`, { method: "DELETE", cookie: admin.cookie }), params({ fecha }));
const preview = async (fecha: string, accion = "AGREGAR") =>
  (await previewRoute(apiRequest("/api/admin/cancellation-window-exclusions/preview", { cookie: admin.cookie, body: { fecha, accion } }))).json();
const windowOf = async (id: string) => (await db().pedido.findUniqueOrThrow({ where: { id } })).inicioVentanaCargo!;
const notices = (usuarioId: string) => db().notificacion.count({ where: { usuarioId, tipo: "VENTANA_CARGO_CAMBIADA" } });

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

describe("fechas excluidas de la ventana de 48 h (RN-30, F-09)", () => {
  it("la vista previa y el recálculo incluyen solo los pedidos afectados; cada uno queda registrado y avisado (T-132)", async () => {
    const affected = await confirmedOrder(ana, 5);
    const far = await confirmedOrder(ana, 20); // la fecha excluida no cae en su ventana
    const fixed = await confirmedOrder(ana, 5);
    await db().pedido.update({ where: { id: fixed }, data: { ventanaCargoFija: true } });
    const shipped = await confirmedOrder(ana, 5);
    await db().pedido.update({ where: { id: shipped }, data: { estado: "DESPACHADO" } });
    const before = { affected: await windowOf(affected), far: await windowOf(far), fixed: await windowOf(fixed), shipped: await windowOf(shipped) };
    expect(before.affected).toEqual(tenAm(day(3)));

    const excluded = day(4);
    const view = await preview(excluded);
    expect(view.pedidos).toEqual([expect.objectContaining({ pedidoId: affected, inicioNuevo: tenAm(day(2)).toISOString() })]);
    expect(await windowOf(affected)).toEqual(before.affected); // la vista previa no modifica nada

    const response = await add(excluded);
    expect(await response.json()).toMatchObject({ recalculados: 1 });
    expect(await windowOf(affected)).toEqual(tenAm(day(2)));
    for (const id of [far, fixed, shipped]) expect(await windowOf(id)).toEqual(before[id === far ? "far" : id === fixed ? "fixed" : "shipped"]);
    expect(await db().cambioVentanaCargo.findMany()).toEqual([
      expect.objectContaining({
        pedidoId: affected,
        causa: "FECHA_EXCLUIDA_AGREGADA",
        inicioAnterior: before.affected,
        inicioNuevo: tenAm(day(2)),
        autorId: admin.id,
      }),
    ]);
    expect(await notices(ana.id)).toBe(1);
  });

  it("un reintento de la misma fecha no recalcula ni avisa otra vez", async () => {
    const id = await confirmedOrder(ana, 5);
    await add(day(4));
    const after = await windowOf(id);
    expect(await (await add(day(4))).json()).toMatchObject({ codigo: "FECHA_YA_EXCLUIDA" });
    expect(await windowOf(id)).toEqual(after);
    expect(await notices(ana.id)).toBe(1);
    expect(await db().cambioVentanaCargo.count()).toBe(1);
  });

  it("si el inicio nuevo quedaría en el pasado, empieza en el momento del aviso: sin cargos retroactivos (T-133)", async () => {
    const id = await confirmedOrder(ana, 3); // la ventana empieza mañana a las 10:00
    const original = await windowOf(id);
    const start = new Date();
    await add(day(2));
    await add(day(1));
    const end = new Date();

    const window = await windowOf(id);
    expect(window.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(window.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(window < original).toBe(true);
    const preview = await (
      await cancelPreviewRoute(apiRequest(`/api/orders/${id}/cancellation-preview`, { method: "GET", cookie: ana.cookie }), params({ id }))
    ).json();
    expect(preview).toMatchObject({ regla: "RN_15", dentroVentana: true });
  });

  it("quitar una fecha recalcula las ventanas, lo registra y avisa (T-134)", async () => {
    const id = await confirmedOrder(ana, 5);
    await add(day(4));
    expect((await preview(day(4), "QUITAR")).pedidos).toEqual([expect.objectContaining({ pedidoId: id, inicioNuevo: tenAm(day(3)).toISOString() })]);

    expect((await remove(day(4))).status).toBe(200);
    expect(await windowOf(id)).toEqual(tenAm(day(3)));
    expect(await db().cambioVentanaCargo.findFirstOrThrow({ where: { causa: "FECHA_EXCLUIDA_QUITADA" } })).toMatchObject({
      pedidoId: id,
      inicioNuevo: tenAm(day(3)),
    });
    expect(await notices(ana.id)).toBe(2);
    expect(await (await remove(day(4))).json()).toMatchObject({ codigo: "FECHA_NO_EXCLUIDA" });
  });

  it("la cancelación usa el inicio guardado y registra qué ventana regía (T-135)", async () => {
    const id = await confirmedOrder(ana, 3);
    await add(day(2));
    await add(day(1));
    const window = await windowOf(id);
    const { desglose } = await (
      await cancelPreviewRoute(apiRequest(`/api/orders/${id}/cancellation-preview`, { method: "GET", cookie: ana.cookie }), params({ id }))
    ).json();
    await cancelRoute(
      apiRequest(`/api/orders/${id}/cancel`, {
        cookie: ana.cookie,
        body: { motivo: "Me arrepentí", cargoEsperadoCentavos: desglose.cargoCentavos, aReembolsarEsperadoCentavos: desglose.aReembolsarCentavos },
      }),
      params({ id }),
    );
    expect(await db().cancelacion.findUniqueOrThrow({ where: { pedidoId: id } })).toMatchObject({
      regla: "RN_15",
      dentroVentana: true,
      inicioVentanaCargo: window,
    });
  });

  it("una fecha comprometida nueva ya considera las exclusiones", async () => {
    await add(day(9));
    const id = await confirmedOrder(ana, 10);
    expect(await windowOf(id)).toEqual(tenAm(day(7)));
  });

  it("dos fechas agregadas a la vez: el resultado considera las dos", async () => {
    const id = await confirmedOrder(ana, 6);
    const statuses = (await Promise.all([add(day(5)), add(day(4))])).map((response) => response.status);
    expect(statuses).toEqual([201, 201]);
    expect(await windowOf(id)).toEqual(tenAm(day(2)));
    expect(await db().cambioVentanaCargo.count({ where: { pedidoId: id } })).toBe(2);
  });

  it("solo el admin gestiona las fechas; una fecha inválida se rechaza", async () => {
    expect((await add(day(4), ana.cookie)).status).toBe(403);
    expect((await add("2026-13-40")).status).toBe(422);
  });
});
