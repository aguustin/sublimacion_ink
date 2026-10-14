import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/server/shared/db";

/** Quién hace un cambio administrativo. */
export type Actor = { id: string; ip?: string };

export type AuditEvent = {
  actorId?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string;
  /** Nunca incluir contraseñas, tokens ni otros secretos. */
  datos?: Prisma.InputJsonValue;
  ip?: string;
};

/** Registra una acción relevante; se llama dentro de la misma transacción que la acción. */
export async function recordAudit(db: DbClient, event: AuditEvent): Promise<void> {
  await db.eventoAuditoria.create({ data: event });
}
