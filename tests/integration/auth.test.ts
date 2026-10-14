import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as resendVerification } from "@/app/api/auth/resend-verification/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";
import { POST as verifyEmail } from "@/app/api/auth/verify-email/route";
import { getSentEmails } from "@/server/modules/notifications/email";
import { getDb } from "@/server/shared/db";
import { apiRequest, resetDatabase, sessionCookieFrom, tokenFromLastEmail } from "./helpers";

const ANA = { nombre: "Ana", email: "ana@ejemplo.com", contrasena: "clave-segura-1", telefono: "+54 11 5555-1234" };

const db = () => getDb();

async function registerAna(overrides: Partial<typeof ANA> = {}) {
  const response = await register(apiRequest("/api/auth/register", { body: { ...ANA, ...overrides } }));
  expect(response.status).toBe(201);
  return sessionCookieFrom(response);
}

const loginAs = (email: string, contrasena: string) => login(apiRequest("/api/auth/login", { body: { email, contrasena } }));
const meWith = (cookie?: string) => me(apiRequest("/api/auth/me", { method: "GET", cookie }));

beforeEach(resetDatabase);
afterAll(async () => {
  await db().$disconnect();
});

describe("registro (RF-01, RN-25)", () => {
  it("crea la cuenta, inicia sesión y envía el email de confirmación", async () => {
    const response = await register(
      apiRequest("/api/auth/register", { body: { ...ANA, email: "  Ana@Ejemplo.COM " } }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.usuario).toEqual({
      id: expect.any(String),
      email: "ana@ejemplo.com",
      nombre: "Ana",
      telefono: ANA.telefono,
      rol: "CLIENTE",
      emailVerificado: false,
    });
    expect(JSON.stringify(body)).not.toContain("hash");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect((await meWith(sessionCookieFrom(response))).status).toBe(200);

    const [email] = getSentEmails();
    expect(email?.to).toBe("ana@ejemplo.com");
    expect(email?.text).toContain("http://localhost:3000/verificar-email?token=");

    const user = await db().usuario.findUniqueOrThrow({ where: { email: "ana@ejemplo.com" } });
    expect(user.hashContrasena).toMatch(/^\$argon2id\$/);
    expect(await db().eventoAuditoria.count({ where: { accion: "REGISTRO", actorId: user.id } })).toBe(1);
  });

  it("guarda solo el hash del token de sesión", async () => {
    const cookie = await registerAna();
    const token = cookie.slice("sesion=".length);
    const sessions = await db().sesion.findMany();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.hashToken).not.toBe(token);
  });

  it("rechaza un email ya registrado aunque cambien las mayúsculas", async () => {
    await registerAna();
    const response = await register(apiRequest("/api/auth/register", { body: { ...ANA, email: "ANA@ejemplo.com" } }));

    expect(response.status).toBe(409);
    expect((await response.json()).codigo).toBe("EMAIL_EN_USO");
  });

  it("valida los datos e informa los campos inválidos", async () => {
    const response = await register(apiRequest("/api/auth/register", { body: { ...ANA, contrasena: "corta" } }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detalles).toEqual([{ campo: "contrasena", mensaje: expect.any(String) }]);
    expect(await db().usuario.count()).toBe(0);
  });

  it("responde 400 ante un cuerpo que no es JSON", async () => {
    const request = new Request("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: "{roto",
    });
    expect((await register(request)).status).toBe(400);
  });
});

describe("inicio y cierre de sesión", () => {
  it("inicia sesión con las credenciales correctas", async () => {
    await registerAna();
    const response = await loginAs("ANA@ejemplo.com", ANA.contrasena);

    expect(response.status).toBe(200);
    expect((await meWith(sessionCookieFrom(response))).status).toBe(200);
  });

  it("responde lo mismo ante una contraseña incorrecta o un email inexistente", async () => {
    await registerAna();
    const wrongPassword = await loginAs(ANA.email, "otra-clave-cualquiera");
    const unknownEmail = await loginAs("nadie@ejemplo.com", ANA.contrasena);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
  });

  it("bloquea temporalmente después de 10 intentos con el mismo email (T-46)", async () => {
    await registerAna();
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await loginAs(ANA.email, "incorrecta-123")).status).toBe(401);
    }
    const blocked = await loginAs(ANA.email, ANA.contrasena);

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ codigo: "DEMASIADOS_INTENTOS" });
  });

  it("cerrar sesión invalida la cookie en el servidor", async () => {
    const cookie = await registerAna();
    const response = await logout(apiRequest("/api/auth/logout", { cookie }));

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await meWith(cookie)).status).toBe(401);
    expect(await db().eventoAuditoria.count({ where: { accion: "CIERRE_SESION" } })).toBe(1);
  });

  it("rechaza una sesión inexistente o vencida", async () => {
    expect(await (await meWith()).json()).toMatchObject({ codigo: "NO_AUTENTICADO" });
    expect((await meWith("sesion=inventada")).status).toBe(401);

    const cookie = await registerAna();
    await db().sesion.updateMany({ data: { expiraEn: new Date(Date.now() - 1000) } });
    expect((await meWith(cookie)).status).toBe(401);
  });

  it("rechaza un inicio de sesión desde otro origen (CSRF)", async () => {
    await registerAna();
    const response = await login(
      apiRequest("/api/auth/login", { body: { email: ANA.email, contrasena: ANA.contrasena }, origin: "https://malicioso.ejemplo" }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).codigo).toBe("ORIGEN_NO_PERMITIDO");
    expect(await db().sesion.count()).toBe(1); // solo la del registro
  });
});

describe("verificación de email", () => {
  it("confirma el email con el token del correo, una sola vez", async () => {
    const cookie = await registerAna();
    const token = tokenFromLastEmail();

    const first = await verifyEmail(apiRequest("/api/auth/verify-email", { body: { token } }));
    const second = await verifyEmail(apiRequest("/api/auth/verify-email", { body: { token } }));

    expect(first.status).toBe(200);
    expect((await (await meWith(cookie)).json()).usuario.emailVerificado).toBe(true);
    expect(second.status).toBe(400);
    expect((await second.json()).codigo).toBe("TOKEN_INVALIDO");
  });

  it("acepta un solo uso aunque el token se envíe dos veces a la vez", async () => {
    await registerAna();
    const token = tokenFromLastEmail();

    const statuses = await Promise.all(
      [1, 2].map(async () => (await verifyEmail(apiRequest("/api/auth/verify-email", { body: { token } }))).status),
    );

    expect(statuses.sort()).toEqual([200, 400]);
  });

  it("rechaza un token vencido", async () => {
    await registerAna();
    await db().tokenUsuario.updateMany({ data: { expiraEn: new Date(Date.now() - 1000) } });

    const response = await verifyEmail(apiRequest("/api/auth/verify-email", { body: { token: tokenFromLastEmail() } }));
    expect(response.status).toBe(400);
  });

  it("al reenviar el correo, el enlace anterior deja de servir", async () => {
    const cookie = await registerAna();
    const oldToken = tokenFromLastEmail();

    expect((await resendVerification(apiRequest("/api/auth/resend-verification", { cookie }))).status).toBe(202);
    const newToken = tokenFromLastEmail();

    expect(newToken).not.toBe(oldToken);
    expect((await verifyEmail(apiRequest("/api/auth/verify-email", { body: { token: oldToken } }))).status).toBe(400);
    expect((await verifyEmail(apiRequest("/api/auth/verify-email", { body: { token: newToken } }))).status).toBe(200);
  });

  it("reenviar exige una sesión", async () => {
    expect((await resendVerification(apiRequest("/api/auth/resend-verification"))).status).toBe(401);
  });
});

describe("recuperación de contraseña (RF-02)", () => {
  const forgot = (email: string) => forgotPassword(apiRequest("/api/auth/forgot-password", { body: { email } }));
  const reset = (token: string, contrasena: string) =>
    resetPassword(apiRequest("/api/auth/reset-password", { body: { token, contrasena } }));

  it("responde igual exista o no la cuenta, y solo envía correo si existe", async () => {
    await registerAna();
    const emailsAfterRegister = getSentEmails().length;

    const unknown = await forgot("nadie@ejemplo.com");
    expect(getSentEmails()).toHaveLength(emailsAfterRegister);

    const known = await forgot(ANA.email);
    expect(getSentEmails()).toHaveLength(emailsAfterRegister + 1);
    expect(getSentEmails().at(-1)?.text).toContain("/restablecer-contrasena?token=");

    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("cambia la contraseña, cierra todas las sesiones y el enlace no se puede reusar", async () => {
    const oldSession = await registerAna();
    await forgot(ANA.email);
    const token = tokenFromLastEmail();

    expect((await reset(token, "clave-nueva-2")).status).toBe(200);

    expect((await meWith(oldSession)).status).toBe(401);
    expect((await loginAs(ANA.email, ANA.contrasena)).status).toBe(401);
    const newLogin = await loginAs(ANA.email, "clave-nueva-2");
    expect(newLogin.status).toBe(200);
    expect((await newLogin.json()).usuario.emailVerificado).toBe(true);
    expect((await reset(token, "clave-nueva-3")).status).toBe(400);
  });

  it("no acepta un token de verificación de email para cambiar la contraseña", async () => {
    await registerAna();
    expect((await reset(tokenFromLastEmail(), "clave-nueva-2")).status).toBe(400);
  });
});
