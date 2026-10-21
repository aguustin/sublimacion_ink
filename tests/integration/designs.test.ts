import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as quoteRoute } from "@/app/api/admin/custom-orders/[id]/quote/route";
import { POST as versionRoute } from "@/app/api/admin/order-items/[id]/design-versions/route";
import { POST as storeCancelRoute } from "@/app/api/admin/orders/[id]/cancel/route";
import { POST as transitionsRoute } from "@/app/api/admin/orders/[id]/transitions/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as acceptRoute } from "@/app/api/custom-orders/[id]/quote/accept/route";
import { POST as requestRoute } from "@/app/api/custom-orders/route";
import { POST as approveRoute } from "@/app/api/design-versions/[id]/approve/route";
import { POST as changesRoute } from "@/app/api/design-versions/[id]/request-changes/route";
import { DELETE as deleteFileRoute } from "@/app/api/files/[id]/route";
import { GET as fileUrlRoute } from "@/app/api/files/[id]/url/route";
import { POST as uploadRoute } from "@/app/api/files/route";
import { GET as designsRoute } from "@/app/api/orders/[id]/designs/route";
import { POST as payRoute } from "@/app/api/payments/simulated/[orderId]/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { clearMemoryObjects } from "@/server/modules/files/storage";
import { transitionOrder } from "@/server/modules/orders/order-transitions";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

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

/** Personalizado con la cotización aceptada; con `pagar`, además con la seña cobrada (CONFIRMADO). */
async function customOrder(user: Account, { modalidadCierre = "ONLINE", pagar = true } = {}) {
  const actor = { id: admin.id };
  const category = await createCategory(actor, { nombre: `Categoría ${crypto.randomUUID().slice(0, 8)}` });
  const product = await createProduct(actor, { nombre: "Cartel", categoriaId: category.id, tipo: "PERSONALIZABLE" });
  const varianteId = (await createVariant(actor, product.id, { material: "Lona" })).id;
  const created = await requestRoute(
    new Request(`${APP_URL}/api/custom-orders`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ varianteId, cantidad: 1, descripcion: "Cartel con el logo", fechaDeseada: "2026-12-01", modalidadEntrega: "RETIRO" }),
    }),
  );
  const id = (await created.json()).pedido.id as string;
  const quoted = await quoteRoute(
    apiRequest(`/api/admin/custom-orders/${id}/quote`, {
      cookie: admin.cookie,
      body: { precioUnitarioCentavos: 500000, fechaEntregaPropuesta: "2026-12-10", detalle: "Lona" },
    }),
    params({ id }),
  );
  const cotizacionId = (await quoted.json()).cotizacion.id;
  await acceptRoute(
    apiRequest(`/api/custom-orders/${id}/quote/accept`, {
      cookie: user.cookie,
      body: { cotizacionId, modalidadCierre, totalEsperadoCentavos: 500000 },
    }),
    params({ id }),
  );
  if (pagar)
    await payRoute(apiRequest(`/api/payments/simulated/${id}`, { cookie: user.cookie, body: { resultado: "APROBADO" } }), params({ orderId: id }));
  const item = await db().itemPedido.findFirstOrThrow({ where: { pedidoId: id } });
  return { id, itemId: item.id };
}

async function designFile(user: Account, contexto = "VERSION_DISENO", seed = 1) {
  const form = new FormData();
  form.set("archivo", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, seed])], `diseño-${seed}.pdf`));
  form.set("contexto", contexto);
  const response = await uploadRoute(
    new Request(`${APP_URL}/api/files`, { method: "POST", headers: { origin: APP_URL, cookie: user.cookie }, body: form }),
  );
  return (await response.json()).archivo?.id as string;
}

async function version(itemId: string, seed = 1, user = admin) {
  const archivoId = await designFile(admin, "VERSION_DISENO", seed);
  const response = await versionRoute(
    apiRequest(`/api/admin/order-items/${itemId}/design-versions`, { cookie: user.cookie, body: { archivoIds: [archivoId] } }),
    params({ id: itemId }),
  );
  return { status: response.status, version: (await response.json()).version as { id: string; huella: string; numero: number }, archivoId };
}

const approve = (user: Account, versionId: string, huella: string) =>
  approveRoute(apiRequest(`/api/design-versions/${versionId}/approve`, { cookie: user.cookie, body: { huella } }), params({ id: versionId }));
const startProduction = (id: string) =>
  transitionsRoute(apiRequest(`/api/admin/orders/${id}/transitions`, { cookie: admin.cookie, body: { estado: "EN_PRODUCCION" } }), params({ id }));
const codeOf = async (response: Response) => (await response.json()).codigo;

let admin: Account;
let ana: Account;

beforeEach(async () => {
  await resetDatabase();
  clearMemoryObjects();
  admin = await account("admin@tienda.ejemplo", true);
  ana = await account("ana@ejemplo.com");
});
afterAll(async () => {
  await db().$disconnect();
});

describe("versiones y aprobación (RN-07, sección 15)", () => {
  it("v1 cargada, el cliente la ve y la aprueba con su huella; el pedido pasa a producción", async () => {
    const { id, itemId } = await customOrder(ana);
    const { status, version: v1 } = await version(itemId);
    expect(status).toBe(201);
    expect(await db().diseno.findUniqueOrThrow({ where: { itemPedidoId: itemId } })).toMatchObject({
      estado: "PENDIENTE_APROBACION",
      versionVigenteId: v1.id,
    });

    const { items } = await (
      await designsRoute(apiRequest(`/api/orders/${id}/designs`, { method: "GET", cookie: ana.cookie }), params({ id }))
    ).json();
    expect(items[0].diseno.versiones[0]).toMatchObject({ id: v1.id, numero: 1, huella: v1.huella });

    expect((await approve(ana, v1.id, v1.huella)).status).toBe(201);
    expect(await db().aprobacionDiseno.findUniqueOrThrow({ where: { versionId: v1.id } })).toMatchObject({
      aprobadaPorId: ana.id,
      huellaAprobada: v1.huella,
    });
    expect(await db().notificacion.count({ where: { usuarioId: admin.id, tipo: "DISENO_APROBADO" } })).toBe(1);

    expect((await startProduction(id)).status).toBe(200);
    expect((await db().pedido.findUniqueOrThrow({ where: { id } })).estado).toBe("EN_PRODUCCION");
  });

  it("sin versiones no pasa a producción (T-20)", async () => {
    const { id } = await customOrder(ana);
    expect(await codeOf(await startProduction(id))).toBe("DISENO_NO_APROBADO");
  });

  it("v1 aprobada y v2 cargada: vuelve a requerir aprobación, v1 ya no se puede aprobar y la producción se rechaza (T-21, T-22, CA-09)", async () => {
    const { id, itemId } = await customOrder(ana);
    const { version: v1 } = await version(itemId, 1);
    await approve(ana, v1.id, v1.huella);
    const { version: v2 } = await version(itemId, 2);

    expect(v2.numero).toBe(2);
    expect(await db().diseno.findUniqueOrThrow({ where: { itemPedidoId: itemId } })).toMatchObject({
      estado: "PENDIENTE_APROBACION",
      versionVigenteId: v2.id,
    });
    expect(await db().aprobacionDiseno.count({ where: { versionId: v1.id } })).toBe(1); // la aprobación anterior queda como historia
    expect(await codeOf(await startProduction(id))).toBe("DISENO_NO_APROBADO");
    expect(await codeOf(await approve(ana, v1.id, v1.huella))).toBe("VERSION_NO_VIGENTE");
  });

  it("una huella distinta se rechaza (T-23)", async () => {
    const { itemId } = await customOrder(ana);
    const { version: v1 } = await version(itemId);
    expect(await codeOf(await approve(ana, v1.id, "0".repeat(64)))).toBe("HUELLA_DISTINTA");
    expect(await db().aprobacionDiseno.count()).toBe(0);
  });

  it("una versión no se puede modificar: no hay operación y la base lo impide (T-24)", async () => {
    const { itemId } = await customOrder(ana);
    const { version: v1 } = await version(itemId);
    await expect(db().versionDiseno.update({ where: { id: v1.id }, data: { nota: "cambiada" } })).rejects.toThrow();
    await expect(db().archivoVersionDiseno.deleteMany({ where: { versionId: v1.id } })).rejects.toThrow();
  });

  it("dos aprobaciones simultáneas: una sola se registra", async () => {
    const { itemId } = await customOrder(ana);
    const { version: v1 } = await version(itemId);
    const statuses = (await Promise.all([approve(ana, v1.id, v1.huella), approve(ana, v1.id, v1.huella)])).map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await db().aprobacionDiseno.count()).toBe(1);
  });

  it("pedir cambios: sin límite de rondas; con una versión nueva vuelve a estar pendiente (RF-26, D-29)", async () => {
    const { itemId } = await customOrder(ana);
    const { version: v1 } = await version(itemId, 1);
    const changes = (versionId: string) =>
      changesRoute(
        apiRequest(`/api/design-versions/${versionId}/request-changes`, { cookie: ana.cookie, body: { comentario: "Más grande el logo" } }),
        params({ id: versionId }),
      );

    expect((await changes(v1.id)).status).toBe(201);
    expect((await db().diseno.findUniqueOrThrow({ where: { itemPedidoId: itemId } })).estado).toBe("CAMBIOS_SOLICITADOS");
    const { version: v2 } = await version(itemId, 2);
    expect((await changes(v2.id)).status).toBe(201);
    const { version: v3 } = await version(itemId, 3);
    expect(v3.numero).toBe(3);
    expect(await db().solicitudCambio.count()).toBe(2);
  });
});

describe("permisos y archivos del diseño", () => {
  it("otro cliente no ve ni aprueba el diseño ni sus archivos; el dueño sí ve los archivos (T-25)", async () => {
    const { id, itemId } = await customOrder(ana);
    const { version: v1, archivoId } = await version(itemId);
    const bruno = await account("bruno@ejemplo.com");

    expect((await approve(bruno, v1.id, v1.huella)).status).toBe(404);
    expect((await designsRoute(apiRequest(`/api/orders/${id}/designs`, { method: "GET", cookie: bruno.cookie }), params({ id }))).status).toBe(404);
    const url = (user: Account) =>
      fileUrlRoute(apiRequest(`/api/files/${archivoId}/url`, { method: "GET", cookie: user.cookie }), params({ id: archivoId }));
    expect((await url(bruno)).status).toBe(404);
    expect((await url(ana)).status).toBe(200);
  });

  it("solo el admin carga versiones, con archivos de diseño activos; un archivo en uso no se borra", async () => {
    const { itemId } = await customOrder(ana);
    expect((await version(itemId, 1, ana)).status).toBe(403);

    const reference = await designFile(ana, "REFERENCIA", 9);
    const wrong = await versionRoute(
      apiRequest(`/api/admin/order-items/${itemId}/design-versions`, { cookie: admin.cookie, body: { archivoIds: [reference] } }),
      params({ id: itemId }),
    );
    expect(await codeOf(wrong)).toBe("ARCHIVO_NO_ENCONTRADO");

    const { archivoId } = await version(itemId, 2);
    const removal = await deleteFileRoute(
      apiRequest(`/api/files/${archivoId}`, { method: "DELETE", cookie: admin.cookie }),
      params({ id: archivoId }),
    );
    expect(await codeOf(removal)).toBe("ARCHIVO_EN_USO");
  });
});

describe("habilitación para fabricar (RN-07, 15.4)", () => {
  it("con dos ítems personalizados y uno solo aprobado, la producción se rechaza (T-26)", async () => {
    const { id, itemId } = await customOrder(ana);
    const { version: v1 } = await version(itemId);
    await approve(ana, v1.id, v1.huella);
    const item = await db().itemPedido.findFirstOrThrow({ where: { id: itemId } });
    await db().itemPedido.create({
      data: { pedidoId: id, varianteId: item.varianteId, descripcion: "Segundo cartel", precioUnitarioCentavos: 1, cantidad: 1 },
    });

    expect(await codeOf(await startProduction(id))).toBe("DISENO_NO_APROBADO");
  });

  it("una reserva sin seña no pasa a producción aunque el diseño esté aprobado; el diseño avanza antes del pago (T-27)", async () => {
    const { id, itemId } = await customOrder(ana, { modalidadCierre: "EFECTIVO", pagar: false });
    expect((await db().pedido.findUniqueOrThrow({ where: { id } })).estado).toBe("RESERVADO");
    const { version: v1 } = await version(itemId);
    expect((await approve(ana, v1.id, v1.huella)).status).toBe(201);
    expect(await codeOf(await startProduction(id))).toBe("ESTADO_INVALIDO");
  });

  it("una versión nueva en producción se permite y bloquea el paso a listo para retirar hasta aprobarla (D-26)", async () => {
    const { id, itemId } = await customOrder(ana);
    const { version: v1 } = await version(itemId, 1);
    await approve(ana, v1.id, v1.huella);
    await startProduction(id);

    const { status, version: v2 } = await version(itemId, 2);
    expect(status).toBe(201);
    const toReady = () => db().$transaction((tx) => transitionOrder(tx, { pedidoId: id, from: "EN_PRODUCCION", to: "LISTO_PARA_RETIRO" }));
    expect(await toReady().catch((error) => error)).toMatchObject({ code: "DISENO_NO_APROBADO" });
    expect(await db().notificacion.count({ where: { usuarioId: ana.id, tipo: "VERSION_DISENO_CARGADA" } })).toBe(2);

    await approve(ana, v2.id, v2.huella);
    expect(await toReady()).toBe(true);
  });

  it("un pedido cancelado no admite cambios de diseño", async () => {
    const { id, itemId } = await customOrder(ana);
    await storeCancelRoute(apiRequest(`/api/admin/orders/${id}/cancel`, { cookie: admin.cookie, body: { motivo: "Sin lona" } }), params({ id }));
    expect((await version(itemId)).status).toBe(409);
  });
});
