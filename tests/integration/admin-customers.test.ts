import { execFileSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as block } from "@/app/api/admin/customers/[id]/block/route";
import { POST as unblock } from "@/app/api/admin/customers/[id]/unblock/route";
import { GET as listCustomers } from "@/app/api/admin/customers/route";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as register } from "@/app/api/auth/register/route";
import { getSentEmails } from "@/server/modules/notifications/email";
import { getDb } from "@/server/shared/db";
import { apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const PASSWORD = "clave-segura-1";

async function createAccount(nombre: string, email: string) {
  const response = await register(apiRequest("/api/auth/register", { body: { nombre, email, contrasena: PASSWORD } }));
  const { usuario } = await response.json();
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

async function createAdmin() {
  const admin = await createAccount("Admin", "admin@tienda.ejemplo");
  await getDb().usuario.update({ where: { id: admin.id }, data: { rol: "ADMIN" } });
  return admin;
}

const list = (cookie?: string, query = "") =>
  listCustomers(apiRequest(`/api/admin/customers${query}`, { method: "GET", cookie }));
const blockCustomer = (cookie: string, id: string, body: unknown = { motivo: "Pedidos falsos reiterados" }) =>
  block(apiRequest(`/api/admin/customers/${id}/block`, { cookie, body }), params({ id }));

beforeEach(resetDatabase);
afterAll(async () => {
  await getDb().$disconnect();
});

describe("autorización de endpoints administrativos", () => {
  it("exige sesión (401) y rol de administrador (403, T-42)", async () => {
    const client = await createAccount("Ana", "ana@ejemplo.com");

    expect((await list()).status).toBe(401);
    const forbidden = await list(client.cookie);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).codigo).toBe("SIN_PERMISO");
    expect((await blockCustomer(client.cookie, client.id)).status).toBe(403);
  });

  it("el administrador lista y busca solo clientes", async () => {
    const admin = await createAdmin();
    await createAccount("Ana", "ana@ejemplo.com");
    await createAccount("Bruno", "bruno@ejemplo.com");

    const all = await (await list(admin.cookie)).json();
    expect(all.total).toBe(2);
    expect(all.clientes.map((c: { email: string }) => c.email).sort()).toEqual(["ana@ejemplo.com", "bruno@ejemplo.com"]);
    expect(JSON.stringify(all)).not.toContain("hash");

    const search = await (await list(admin.cookie, "?q=BRU")).json();
    expect(search.clientes.map((c: { nombre: string }) => c.nombre)).toEqual(["Bruno"]);
  });
});

describe("bloqueo de cuentas", () => {
  it("bloquear cierra las sesiones del cliente, impide el login y queda auditado", async () => {
    const admin = await createAdmin();
    const client = await createAccount("Ana", "ana@ejemplo.com");

    expect((await blockCustomer(admin.cookie, client.id)).status).toBe(204);

    expect((await me(apiRequest("/api/auth/me", { method: "GET", cookie: client.cookie }))).status).toBe(401);
    const blockedLogin = await login(apiRequest("/api/auth/login", { body: { email: "ana@ejemplo.com", contrasena: PASSWORD } }));
    expect(blockedLogin.status).toBe(403);
    expect((await blockedLogin.json()).codigo).toBe("CUENTA_BLOQUEADA");

    const event = await getDb().eventoAuditoria.findFirstOrThrow({ where: { accion: "CUENTA_BLOQUEADA" } });
    expect(event).toMatchObject({ actorId: admin.id, entidadId: client.id, datos: { motivo: "Pedidos falsos reiterados" } });
  });

  it("una cuenta bloqueada no recibe enlaces de recuperación", async () => {
    const admin = await createAdmin();
    const client = await createAccount("Ana", "ana@ejemplo.com");
    await blockCustomer(admin.cookie, client.id);
    const emailsBefore = getSentEmails().length;

    const response = await forgotPassword(apiRequest("/api/auth/forgot-password", { body: { email: "ana@ejemplo.com" } }));

    expect(response.status).toBe(202);
    expect(getSentEmails()).toHaveLength(emailsBefore);
  });

  it("desbloquear permite volver a ingresar", async () => {
    const admin = await createAdmin();
    const client = await createAccount("Ana", "ana@ejemplo.com");
    await blockCustomer(admin.cookie, client.id);

    const response = await unblock(apiRequest(`/api/admin/customers/${client.id}/unblock`, { cookie: admin.cookie, body: {} }), params({ id: client.id }));

    expect(response.status).toBe(204);
    expect((await login(apiRequest("/api/auth/login", { body: { email: "ana@ejemplo.com", contrasena: PASSWORD } }))).status).toBe(200);
  });

  it("exige un motivo y solo bloquea clientes existentes", async () => {
    const admin = await createAdmin();
    const client = await createAccount("Ana", "ana@ejemplo.com");

    expect((await blockCustomer(admin.cookie, client.id, { motivo: "" })).status).toBe(422);
    expect((await blockCustomer(admin.cookie, "no-es-un-uuid")).status).toBe(404);
    expect((await blockCustomer(admin.cookie, crypto.randomUUID())).status).toBe(404);
    expect((await blockCustomer(admin.cookie, admin.id)).status).toBe(404);
  });
});

describe("script para promover un administrador", () => {
  it("da el rol ADMIN a una cuenta existente y lo audita", async () => {
    const account = await createAccount("Dueña", "duena@tienda.ejemplo");

    execFileSync("node", ["scripts/promover-admin.mjs", "  DUENA@tienda.ejemplo "], { stdio: "pipe" });

    expect((await getDb().usuario.findUniqueOrThrow({ where: { id: account.id } })).rol).toBe("ADMIN");
    expect(await getDb().eventoAuditoria.count({ where: { accion: "ROL_ADMIN_ASIGNADO", entidadId: account.id } })).toBe(1);
  });

  it("falla con un email sin cuenta", () => {
    expect(() => execFileSync("node", ["scripts/promover-admin.mjs", "nadie@ejemplo.com"], { stdio: "pipe" })).toThrow();
  });
});
