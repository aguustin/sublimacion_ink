import { getDb, type Db } from "@/server/shared/db";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Borra registros que ya no sirven para nada (R-22): sesiones vencidas, tokens usados o vencidos y
 * contadores de límites de más de un día (las ventanas más largas son de una hora). La auditoría
 * de esas acciones queda en `evento_auditoria`.
 */
export async function cleanupExpiredRecords(db: Db = getDb(), now = new Date()) {
  const [sesiones, tokens, limites] = await Promise.all([
    db.sesion.deleteMany({ where: { expiraEn: { lt: now } } }),
    db.tokenUsuario.deleteMany({ where: { OR: [{ expiraEn: { lt: now } }, { usadoEn: { not: null } }] } }),
    db.limiteSolicitud.deleteMany({ where: { ventanaInicio: { lt: new Date(now.getTime() - ONE_DAY_MS) } } }),
  ]);
  return { sesiones: sesiones.count, tokens: tokens.count, limites: limites.count };
}
