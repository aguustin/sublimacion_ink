import type { Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { logger } from "@/server/shared/logger";
import { getEmailSender, type EmailSender } from "./email";

// Envío del outbox (16.3): toma los correos pendientes, los envía y, si falla, reintenta con
// espera creciente. Una falla del correo nunca afecta la operación que lo encoló.

/** Tras este intento fallido, el correo queda `FALLIDA` y visible en el panel. */
export const OUTBOX_MAX_ATTEMPTS = 5;

/** Espera antes del próximo intento, según cuántos fallaron: 1 min, 5 min, 30 min y 2 h. */
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120];

const BATCH_SIZE = 50;

export type DispatchResult = { revisados: number; enviados: number; reintentos: number; fallidos: number };

type Outcome = "enviado" | "reintento" | "fallido" | null;

/** Proceso del cron, cada 1 minuto. Idempotente: dos ejecuciones simultáneas no envían dos veces el mismo correo. */
export async function dispatchOutbox(db: Db = getDb(), sender: EmailSender = getEmailSender()): Promise<DispatchResult> {
  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM salida_notificacion
    WHERE estado = 'PENDIENTE' AND proximo_intento_en <= now()
    ORDER BY proximo_intento_en
    LIMIT ${BATCH_SIZE}`;

  const result: DispatchResult = { revisados: candidates.length, enviados: 0, reintentos: 0, fallidos: 0 };
  for (const { id } of candidates) {
    const outcome = await db.$transaction((tx) => sendOne(tx, id, sender));
    if (outcome === "enviado") result.enviados++;
    if (outcome === "reintento") result.reintentos++;
    if (outcome === "fallido") result.fallidos++;
  }
  if (result.revisados > 0) logger.info(result, "outbox procesado");
  return result;
}

/**
 * `SKIP LOCKED`: si otra ejecución tiene el correo, se saltea. La condición se vuelve a comprobar
 * con la fila bloqueada. Si el envío funcionó pero la marca falla, el correo se reenvía en la
 * próxima ejecución (al menos una vez): es preferible a perderlo.
 */
async function sendOne(tx: Prisma.TransactionClient, id: string, sender: EmailSender): Promise<Outcome> {
  const [email] = await tx.$queryRaw<{ destinatario: string; asunto: string; cuerpo: string; intentos: number }[]>`
    SELECT destinatario, asunto, cuerpo, intentos FROM salida_notificacion
    WHERE id = ${id}::uuid AND estado = 'PENDIENTE' AND proximo_intento_en <= now()
    FOR UPDATE SKIP LOCKED`;
  if (!email) return null;

  const intentos = email.intentos + 1;
  try {
    await sender.send({ to: email.destinatario, subject: email.asunto, text: email.cuerpo });
    await tx.salidaNotificacion.update({ where: { id }, data: { estado: "ENVIADA", intentos, error: null } });
    return "enviado";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = intentos >= OUTBOX_MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MINUTES[Math.min(intentos, RETRY_DELAYS_MINUTES.length) - 1]!;
    await tx.salidaNotificacion.update({
      where: { id },
      data: {
        estado: failed ? "FALLIDA" : "PENDIENTE",
        intentos,
        error: message.slice(0, 500),
        proximoIntentoEn: failed ? undefined : new Date(Date.now() + delay * 60_000),
      },
    });
    logger.warn({ salidaId: id, intentos, err: error }, failed ? "correo fallido" : "correo con error, se reintenta");
    return failed ? "fallido" : "reintento";
  }
}

/** Correos que agotaron los reintentos, para el panel. */
export function listFailedEmails(db: Db = getDb()) {
  return db.salidaNotificacion.findMany({ where: { estado: "FALLIDA" }, orderBy: { creadoEn: "desc" }, take: 200 });
}

/** El admin vuelve a poner en cola un correo fallido (por ejemplo, después de corregir el proveedor). */
export async function retryFailedEmail(actor: Actor, id: string, db: Db = getDb()) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("CORREO_NO_ENCONTRADO", "No encontramos ese correo.", 404);
  return db.$transaction(async (tx) => {
    const requeued = await tx.salidaNotificacion.updateMany({
      where: { id, estado: "FALLIDA" },
      data: { estado: "PENDIENTE", intentos: 0, proximoIntentoEn: new Date() },
    });
    if (requeued.count === 0) throw new AppError("CORREO_NO_FALLIDO", "Solo se reintentan correos fallidos.", 409);
    await recordAudit(tx, { actorId: actor.id, accion: "CORREO_REENCOLADO", entidad: "salida_notificacion", entidadId: id, ip: actor.ip });
  });
}
