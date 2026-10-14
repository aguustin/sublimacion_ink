import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/modules/audit/audit.service";
import { getEmailSender, type Email, type EmailSender } from "@/server/modules/notifications/email";
import { getConfig } from "@/server/shared/config";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { logger } from "@/server/shared/logger";
import { consumeRateLimit } from "@/server/shared/rate-limit";
import { EMAIL_VERIFICATION_TTL_SECONDS, PASSWORD_RESET_TTL_SECONDS, RATE_LIMITS } from "./auth.policy";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.schemas";
import { hashPassword, simulatePasswordCheck, verifyPassword } from "./password";
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  toSessionUser,
  type NewSession,
  type SessionUser,
} from "./session.service";
import { consumeUserToken, issueUserToken } from "./user-token.service";

export type AuthDeps = { db: Db; emailSender: EmailSender; appUrl: string };

function defaultDeps(): AuthDeps {
  return { db: getDb(), emailSender: getEmailSender(), appUrl: getConfig().APP_URL };
}

export type AuthResult = { user: SessionUser; session: NewSession };

export async function register(input: unknown, ip: string, deps = defaultDeps()): Promise<AuthResult> {
  const data = registerSchema.parse(input);
  const { db } = deps;
  await consumeRateLimit(db, `registro:ip:${ip}`, RATE_LIMITS.registerByIp);
  const passwordHash = await hashPassword(data.contrasena);

  let result: AuthResult & { verificationToken: string };
  try {
    result = await db.$transaction(async (tx) => {
      const user = await tx.usuario.create({
        data: { email: data.email, nombre: data.nombre, telefono: data.telefono, hashContrasena: passwordHash },
      });
      const verificationToken = await issueUserToken(tx, user.id, "VERIFICACION_EMAIL", EMAIL_VERIFICATION_TTL_SECONDS);
      const session = await createSession(tx, user.id);
      await recordAudit(tx, { actorId: user.id, accion: "REGISTRO", entidad: "usuario", entidadId: user.id, ip });
      return { user: toSessionUser(user), session, verificationToken };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("EMAIL_EN_USO", "Ya existe una cuenta con ese email. Iniciá sesión.", 409);
    }
    throw error;
  }

  await sendSafely(deps.emailSender, verificationEmail(result.user, result.verificationToken, deps.appUrl));
  return { user: result.user, session: result.session };
}

const invalidCredentials = () =>
  new AppError("CREDENCIALES_INVALIDAS", "El email o la contraseña no son correctos.", 401);

export async function login(input: unknown, ip: string, deps = defaultDeps()): Promise<AuthResult> {
  const data = loginSchema.parse(input);
  const { db } = deps;
  // Se cuentan todos los intentos, no solo los fallidos: sin esto se podría probar contraseñas sin límite.
  await consumeRateLimit(db, `login:ip:${ip}`, RATE_LIMITS.loginByIp);
  await consumeRateLimit(db, `login:email:${data.email}`, RATE_LIMITS.loginByEmail);

  const user = await db.usuario.findUnique({ where: { email: data.email } });
  if (!user) {
    await simulatePasswordCheck(data.contrasena);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.hashContrasena, data.contrasena))) throw invalidCredentials();
  // Recién después de validar la contraseña se informa el bloqueo: no revela nada a quien no la sabe.
  if (user.bloqueadoEn) {
    throw new AppError("CUENTA_BLOQUEADA", "Tu cuenta está bloqueada. Comunicate con la tienda.", 403);
  }

  const session = await db.$transaction(async (tx) => {
    const newSession = await createSession(tx, user.id);
    await recordAudit(tx, { actorId: user.id, accion: "INICIO_SESION", entidad: "usuario", entidadId: user.id, ip });
    return newSession;
  });
  return { user: toSessionUser(user), session };
}

export async function logout(token: string | undefined, ip: string, deps = defaultDeps()): Promise<void> {
  if (!token) return;
  await deps.db.$transaction(async (tx) => {
    const userId = await revokeSession(tx, token);
    if (userId) {
      await recordAudit(tx, { actorId: userId, accion: "CIERRE_SESION", entidad: "usuario", entidadId: userId, ip });
    }
  });
}

export async function verifyEmail(input: unknown, deps = defaultDeps()): Promise<void> {
  const { token } = verifyEmailSchema.parse(input);
  await deps.db.$transaction(async (tx) => {
    const userId = await consumeUserToken(tx, token, "VERIFICACION_EMAIL");
    await tx.usuario.updateMany({ where: { id: userId, emailVerificadoEn: null }, data: { emailVerificadoEn: new Date() } });
    await recordAudit(tx, { actorId: userId, accion: "EMAIL_VERIFICADO", entidad: "usuario", entidadId: userId });
  });
}

export async function resendVerification(user: SessionUser, deps = defaultDeps()): Promise<void> {
  if (user.emailVerificado) return;
  const { db } = deps;
  await consumeRateLimit(db, `verificacion:usuario:${user.id}`, RATE_LIMITS.resendVerificationByUser);
  const token = await db.$transaction((tx) =>
    issueUserToken(tx, user.id, "VERIFICACION_EMAIL", EMAIL_VERIFICATION_TTL_SECONDS),
  );
  await sendSafely(deps.emailSender, verificationEmail(user, token, deps.appUrl));
}

/** Siempre responde igual, exista o no la cuenta, para no revelar qué emails están registrados. */
export async function requestPasswordReset(input: unknown, ip: string, deps = defaultDeps()): Promise<void> {
  const { email } = forgotPasswordSchema.parse(input);
  const { db } = deps;
  await consumeRateLimit(db, `recuperacion:ip:${ip}`, RATE_LIMITS.passwordResetByIp);
  await consumeRateLimit(db, `recuperacion:email:${email}`, RATE_LIMITS.passwordResetByEmail);

  const user = await db.usuario.findUnique({ where: { email } });
  if (!user || user.bloqueadoEn) return;

  const token = await db.$transaction(async (tx) => {
    const resetToken = await issueUserToken(tx, user.id, "RESTABLECER_CONTRASENA", PASSWORD_RESET_TTL_SECONDS);
    await recordAudit(tx, { actorId: user.id, accion: "RECUPERACION_SOLICITADA", entidad: "usuario", entidadId: user.id, ip });
    return resetToken;
  });
  await sendSafely(deps.emailSender, passwordResetEmail(user.email, user.nombre, token, deps.appUrl));
}

/** Cambia la contraseña y cierra todas las sesiones abiertas de la cuenta. */
export async function resetPassword(input: unknown, ip: string, deps = defaultDeps()): Promise<void> {
  const data = resetPasswordSchema.parse(input);
  const passwordHash = await hashPassword(data.contrasena);
  await deps.db.$transaction(async (tx) => {
    const userId = await consumeUserToken(tx, data.token, "RESTABLECER_CONTRASENA");
    const user = await tx.usuario.findUniqueOrThrow({ where: { id: userId } });
    await tx.usuario.update({
      where: { id: userId },
      // Usar el enlace prueba que la persona controla el email.
      data: { hashContrasena: passwordHash, emailVerificadoEn: user.emailVerificadoEn ?? new Date() },
    });
    await revokeAllSessions(tx, userId);
    await recordAudit(tx, { actorId: userId, accion: "CONTRASENA_RESTABLECIDA", entidad: "usuario", entidadId: userId, ip });
  });
}

/** Un correo que no sale no invalida la operación ya registrada (RF-34); queda en el log. */
async function sendSafely(sender: EmailSender, email: Email): Promise<void> {
  try {
    await sender.send(email);
  } catch (error) {
    logger.error({ err: error, asunto: email.subject }, "no se pudo enviar el correo");
  }
}

function verificationEmail(user: Pick<SessionUser, "email" | "nombre">, token: string, appUrl: string): Email {
  return {
    to: user.email,
    subject: "Confirmá tu email",
    text: `Hola, ${user.nombre}. Confirmá tu email entrando a este enlace:\n${appUrl}/verificar-email?token=${token}\n\nEl enlace vence en ${EMAIL_VERIFICATION_TTL_SECONDS / 3600} horas.`,
  };
}

function passwordResetEmail(to: string, name: string, token: string, appUrl: string): Email {
  return {
    to,
    subject: "Restablecé tu contraseña",
    text: `Hola, ${name}. Para elegir una contraseña nueva entrá a este enlace:\n${appUrl}/restablecer-contrasena?token=${token}\n\nEl enlace vence en ${PASSWORD_RESET_TTL_SECONDS / 60} minutos. Si no lo pediste, ignorá este correo.`,
  };
}
