import type { DbClient } from "@/server/shared/db";

export type NotificationInput = {
  usuarioId: string;
  email: string;
  tipo: string;
  titulo: string;
  mensaje: string;
};

/**
 * Registra el aviso dentro del sitio y encola el correo, en la misma transacción que la
 * operación (sección 16.3): si la operación se revierte, no queda un aviso falso; si el correo
 * falla después, la operación no se pierde. El envío del outbox se implementa en INC-10.1.
 */
export async function enqueueNotification(db: DbClient, { usuarioId, email, tipo, titulo, mensaje }: NotificationInput) {
  await db.notificacion.create({ data: { usuarioId, tipo, titulo, mensaje } });
  await db.salidaNotificacion.create({ data: { tipo, destinatario: email, asunto: titulo, cuerpo: mensaje } });
}
