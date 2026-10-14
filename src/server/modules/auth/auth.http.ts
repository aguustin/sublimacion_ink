import { getConfig } from "@/server/shared/config";
import { readCookie, serializeCookie } from "@/server/shared/cookies";
import { getDb, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { SESSION_DURATION_SECONDS } from "./auth.policy";
import { getSessionUser, type NewSession, type SessionUser } from "./session.service";

export const SESSION_COOKIE = "sesion";

function secureCookies(): boolean {
  return getConfig().APP_ENV !== "local";
}

export function readSessionToken(request: Request): string | undefined {
  return readCookie(request, SESSION_COOKIE);
}

export function sessionCookie(session: NewSession): string {
  return serializeCookie(SESSION_COOKIE, session.token, { maxAgeSeconds: SESSION_DURATION_SECONDS, secure: secureCookies() });
}

export function clearedSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: secureCookies() });
}

export function getCurrentUser(request: Request, db: DbClient = getDb()): Promise<SessionUser | null> {
  return getSessionUser(db, readSessionToken(request));
}

export async function requireUser(request: Request, db: DbClient = getDb()): Promise<SessionUser> {
  const user = await getCurrentUser(request, db);
  if (!user) throw new AppError("NO_AUTENTICADO", "Iniciá sesión para continuar.", 401);
  return user;
}

export async function requireAdmin(request: Request, db: DbClient = getDb()): Promise<SessionUser> {
  const user = await requireUser(request, db);
  if (user.rol !== "ADMIN") throw new AppError("SIN_PERMISO", "No tenés permiso para esta acción.", 403);
  return user;
}
