import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteHolidayRoute } from "@/app/api/admin/holidays/[id]/route";
import { GET as listHolidaysRoute, POST as createHolidayRoute } from "@/app/api/admin/holidays/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as addItemRoute } from "@/app/api/cart/items/route";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { registerVariantMovement } from "@/server/modules/inventory/stock.service";
import { reservationExpiry } from "@/server/modules/orders/reservation.policy";
import { localDate } from "@/server/shared/business-hours";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const actor = { id: crypto.randomUUID() };
const db = () => getDb();
const TZ = "America/Argentina/Buenos_Aires";

async function account(email: string, admin = false) {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1", telefono: "1155551234" } }),
  );
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

async function placeOrder(cookie: string, modalidadCierre: "ONLINE" | "EFECTIVO") {
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
  const variant = await createVariant(actor, product.id, { precioCentavos: 150000 });
  await registerVariantMovement(actor, variant.id, { tipo: "INGRESO", cantidad: 5 });
  await addItemRoute(apiRequest("/api/cart/items", { cookie, body: { varianteId: variant.id, cantidad: 1 } }));
  const response = await checkoutRoute(
    new Request(`${APP_URL}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ modalidadCierre, modalidadEntrega: "RETIRO", precios: [{ varianteId: variant.id, precioUnitarioCentavos: 150000 }] }),
    }),
  );
  return (await response.json()).pedido.id as string;
}

const addHoliday = (cookie: string, fecha: string, descripcion = "Feriado de prueba") =>
  createHolidayRoute(apiRequest("/api/admin/holidays", { cookie, body: { fecha, descripcion } }));
const expiryOf = async (id: string) => (await db().pedido.findUniqueOrThrow({ where: { id } })).venceEn!;

beforeEach(resetDatabase);
afterAll(async () => {
  await db().$disconnect();
});

describe("gestión de feriados (RF-58)", () => {
  it("solo el admin los carga, sin fechas repetidas ni inválidas, y los lista por año", async () => {
    const client = await account("ana@ejemplo.com");
    const admin = await account("admin@tienda.ejemplo", true);

    expect((await addHoliday(client.cookie, "2026-12-25")).status).toBe(403);
    expect((await addHoliday(admin.cookie, "2026-13-40")).status).toBe(422);
    expect((await addHoliday(admin.cookie, "2026-12-25", "Navidad")).status).toBe(201);
    const duplicate = await addHoliday(admin.cookie, "2026-12-25", "Navidad");
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).codigo).toBe("FERIADO_EXISTENTE");

    const list = await (await listHolidaysRoute(apiRequest("/api/admin/holidays?anio=2026", { method: "GET", cookie: admin.cookie }))).json();
    expect(list.feriados).toEqual([expect.objectContaining({ descripcion: "Navidad", fecha: "2026-12-25T00:00:00.000Z" })]);
  });
});

describe("recálculo de reservas al cambiar los feriados (RN-29)", () => {
  it("agregar un feriado dentro de una reserva vigente la extiende; quitarlo no la acorta (T-127)", async () => {
    const client = await account("ana@ejemplo.com");
    const admin = await account("admin@tienda.ejemplo", true);
    const reservation = await placeOrder(client.cookie, "EFECTIVO");
    const online = await placeOrder(client.cookie, "ONLINE");
    const before = await expiryOf(reservation);
    const onlineBefore = await expiryOf(online);
    const start = (await db().historialEstadoPedido.findFirstOrThrow({ where: { pedidoId: reservation, estadoNuevo: "RESERVADO" } })).creadoEn;

    // El último día hábil que cuenta en la reserva.
    const lastCountedDay = localDate(new Date(before.getTime() - 1), TZ);
    const created = await addHoliday(admin.cookie, lastCountedDay);
    const { feriado, reservasExtendidas } = await created.json();

    const extended = await expiryOf(reservation);
    expect(reservasExtendidas).toBe(1);
    expect(extended.getTime()).toBeGreaterThan(before.getTime());
    expect(extended).toEqual(reservationExpiry(start, new Set([lastCountedDay]), TZ));
    expect(await expiryOf(online)).toEqual(onlineBefore);

    await deleteHolidayRoute(apiRequest(`/api/admin/holidays/${feriado.id}`, { method: "DELETE", cookie: admin.cookie }), params({ id: feriado.id }));
    expect(await expiryOf(reservation)).toEqual(extended);
  });

  it("un feriado fuera del plazo no cambia nada, y una reserva ya vencida no revive", async () => {
    const client = await account("ana@ejemplo.com");
    const admin = await account("admin@tienda.ejemplo", true);
    const current = await placeOrder(client.cookie, "EFECTIVO");
    const overdue = await placeOrder(client.cookie, "EFECTIVO");
    const overdueAt = new Date(Date.now() - 1000);
    await db().pedido.update({ where: { id: overdue }, data: { venceEn: overdueAt } });
    const before = await expiryOf(current);

    const farAway = localDate(new Date(before.getTime() + 30 * 86_400_000), TZ);
    const created = await (await addHoliday(admin.cookie, farAway)).json();
    expect(created.reservasExtendidas).toBe(0);
    expect(await expiryOf(current)).toEqual(before);

    await addHoliday(admin.cookie, localDate(new Date(), TZ));
    expect(await expiryOf(overdue)).toEqual(overdueAt);
  });

  it("una reserva nueva ya considera los feriados cargados", async () => {
    const client = await account("ana@ejemplo.com");
    const admin = await account("admin@tienda.ejemplo", true);
    const today = localDate(new Date(), TZ);
    const tomorrow = localDate(new Date(Date.now() + 86_400_000), TZ);
    await addHoliday(admin.cookie, today, "Hoy");
    await addHoliday(admin.cookie, tomorrow, "Mañana");

    const holidays = new Set([today, tomorrow]);
    const earliest = reservationExpiry(new Date(), holidays, TZ);
    const reservation = await placeOrder(client.cookie, "EFECTIVO");
    const latest = reservationExpiry(new Date(), holidays, TZ);

    const expiry = await expiryOf(reservation);
    expect(expiry.getTime()).toBeGreaterThanOrEqual(earliest.getTime());
    expect(expiry.getTime()).toBeLessThanOrEqual(latest.getTime());
  });
});
