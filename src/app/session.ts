import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/server/modules/auth/auth.http";
import { getSessionUser, type SessionUser } from "@/server/modules/auth/session.service";
import { getDb } from "@/server/shared/db";

/** Usuario de la sesión en una página del servidor, o `null` si es un visitante. */
export async function getPageUser(): Promise<SessionUser | null> {
  return getSessionUser(getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
}

/** Usuario de la sesión en una página del servidor; sin sesión, redirige a /ingresar. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getPageUser();
  if (!user) redirect("/ingresar");
  return user;
}

/**
 * Cada página de /admin la llama antes de leer datos (no alcanza con el layout, que se
 * renderiza en paralelo). Un cliente ve 404: no se revela que la sección existe.
 */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await requirePageUser();
  if (user.rol !== "ADMIN") notFound();
  return user;
}
