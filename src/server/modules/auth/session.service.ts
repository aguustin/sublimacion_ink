import type { Rol, Usuario } from "@/generated/prisma/client";
import { generateToken, hashToken } from "@/server/shared/crypto";
import type { DbClient } from "@/server/shared/db";
import { SESSION_DURATION_SECONDS } from "./auth.policy";

/** Lo que el resto del sistema sabe del usuario autenticado; nunca incluye el hash de la contraseña. */
export type SessionUser = {
  id: string;
  email: string;
  nombre: string;
  telefono: string | null;
  rol: Rol;
  emailVerificado: boolean;
};

export type NewSession = { token: string; expiresAt: Date };

export function toSessionUser(user: Usuario): SessionUser {
  return {
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    telefono: user.telefono,
    rol: user.rol,
    emailVerificado: user.emailVerificadoEn !== null,
  };
}

export async function createSession(db: DbClient, userId: string): Promise<NewSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  await db.sesion.create({ data: { usuarioId: userId, hashToken: hashToken(token), expiraEn: expiresAt } });
  return { token, expiresAt };
}

/** Usuario de una sesión vigente, o `null` si no existe, venció o la cuenta está bloqueada. */
export async function getSessionUser(db: DbClient, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await db.sesion.findUnique({
    where: { hashToken: hashToken(token) },
    include: { usuario: true },
  });
  if (!session || session.expiraEn <= new Date() || session.usuario.bloqueadoEn) return null;
  return toSessionUser(session.usuario);
}

/** Cierra una sesión; devuelve el id del usuario si existía. */
export async function revokeSession(db: DbClient, token: string): Promise<string | null> {
  const session = await db.sesion.findUnique({ where: { hashToken: hashToken(token) } });
  if (!session) return null;
  await db.sesion.deleteMany({ where: { id: session.id } });
  return session.usuarioId;
}

export async function revokeAllSessions(db: DbClient, userId: string): Promise<void> {
  await db.sesion.deleteMany({ where: { usuarioId: userId } });
}
