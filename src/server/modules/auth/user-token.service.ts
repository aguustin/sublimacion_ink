import type { TipoToken } from "@/generated/prisma/client";
import { generateToken, hashToken } from "@/server/shared/crypto";
import type { DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

/** Emite un token de un solo uso; los anteriores del mismo tipo dejan de servir. */
export async function issueUserToken(db: DbClient, userId: string, type: TipoToken, ttlSeconds: number): Promise<string> {
  const now = new Date();
  await db.tokenUsuario.updateMany({
    where: { usuarioId: userId, tipo: type, usadoEn: null },
    data: { usadoEn: now },
  });
  const token = generateToken();
  await db.tokenUsuario.create({
    data: {
      usuarioId: userId,
      tipo: type,
      hashToken: hashToken(token),
      expiraEn: new Date(now.getTime() + ttlSeconds * 1000),
    },
  });
  return token;
}

/**
 * Marca el token como usado y devuelve el id del usuario. El `UPDATE` es condicional,
 * así que dos usos simultáneos del mismo token no pueden ser válidos a la vez.
 */
export async function consumeUserToken(db: DbClient, token: string, type: TipoToken): Promise<string> {
  const record = await db.tokenUsuario.findUnique({ where: { hashToken: hashToken(token) } });
  if (record?.tipo !== type) throw invalidToken();

  const { count } = await db.tokenUsuario.updateMany({
    where: { id: record.id, usadoEn: null, expiraEn: { gt: new Date() } },
    data: { usadoEn: new Date() },
  });
  if (count === 0) throw invalidToken();
  return record.usuarioId;
}

function invalidToken(): AppError {
  return new AppError("TOKEN_INVALIDO", "El enlace no es válido o ya venció. Pedí uno nuevo.", 400);
}
