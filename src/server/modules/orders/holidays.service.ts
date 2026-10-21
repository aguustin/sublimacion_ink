import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { localDate } from "@/server/shared/business-hours";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { reservationExpiry } from "./reservation.policy";

// Feriados (RF-58, RN-29): el admin los carga; el sistema no los deduce.

const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";

const createHolidaySchema = z.strictObject({
  fecha: z.iso.date("Indicá la fecha (AAAA-MM-DD)."),
  descripcion: z.string().trim().min(1, "Indicá qué feriado es.").max(120),
});

const yearSchema = z.coerce.number().int().min(2000).max(2100);

const asDate = (date: string) => new Date(`${date}T00:00:00Z`);
const asText = (date: Date) => date.toISOString().slice(0, 10);

export async function storeTimeZone(db: DbClient): Promise<string> {
  return (await db.configuracionTienda.findUnique({ where: { id: 1 } }))?.zonaHoraria ?? DEFAULT_TIME_ZONE;
}

/** Feriados desde una fecha local en adelante, como "AAAA-MM-DD". */
async function holidaysFrom(db: DbClient, fromDate: string): Promise<Set<string>> {
  const rows = await db.feriado.findMany({ where: { fecha: { gte: asDate(fromDate) } }, select: { fecha: true } });
  return new Set(rows.map((row) => asText(row.fecha)));
}

/** RN-29: vencimiento de una reserva que empieza en `start`, con los feriados cargados. */
export async function cashReservationExpiry(db: DbClient, start: Date): Promise<Date> {
  const timeZone = await storeTimeZone(db);
  return reservationExpiry(start, await holidaysFrom(db, localDate(start, timeZone)), timeZone);
}

export function listHolidays(input: unknown, db: Db = getDb()) {
  const year = yearSchema.catch(new Date().getUTCFullYear()).parse(input);
  return db.feriado.findMany({
    where: { fecha: { gte: asDate(`${year}-01-01`), lte: asDate(`${year}-12-31`) } },
    orderBy: { fecha: "asc" },
  });
}

/**
 * Agrega un feriado y recalcula las reservas vigentes: un vencimiento solo puede extenderse (RN-29).
 * Cada reserva se recalcula desde su inicio (cuando pasó a `RESERVADO`), con la fila bloqueada para
 * no cruzarse con el proceso de vencimiento.
 */
export async function createHoliday(actor: Actor, input: unknown, db: Db = getDb()) {
  const data = createHolidaySchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const holiday = await tx.feriado.create({ data: { fecha: asDate(data.fecha), descripcion: data.descripcion, creadoPorId: actor.id } });

      const reservations = await tx.$queryRaw<{ id: string; vence_en: Date; inicio: Date }[]>`
        SELECT p.id, p.vence_en, h.creado_en AS inicio
        FROM pedido p
        JOIN LATERAL (
          SELECT creado_en FROM historial_estado_pedido
          WHERE pedido_id = p.id AND estado_nuevo = 'RESERVADO'
          ORDER BY creado_en DESC LIMIT 1
        ) h ON true
        WHERE p.estado = 'RESERVADO' AND p.vence_en > now()
        FOR UPDATE OF p`;

      const timeZone = await storeTimeZone(tx);
      let extendidas = 0;
      for (const reservation of reservations) {
        const holidays = await holidaysFrom(tx, localDate(reservation.inicio, timeZone));
        const newExpiry = reservationExpiry(reservation.inicio, holidays, timeZone);
        if (newExpiry > reservation.vence_en) {
          await tx.pedido.update({ where: { id: reservation.id }, data: { venceEn: newExpiry } });
          extendidas++;
        }
      }

      await recordAudit(tx, {
        actorId: actor.id,
        accion: "FERIADO_CREADO",
        entidad: "feriado",
        entidadId: holiday.id,
        datos: { ...data, reservasExtendidas: extendidas },
        ip: actor.ip,
      });
      return { feriado: holiday, reservasExtendidas: extendidas };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("FERIADO_EXISTENTE", "Ese día ya está cargado como feriado.", 409);
    }
    throw error;
  }
}

/** Quitar un feriado no acorta reservas ya creadas (RN-29); solo afecta las nuevas. */
export async function deleteHoliday(actor: Actor, id: string, db: Db = getDb()) {
  const holiday = /^[0-9a-f-]{36}$/i.test(id) ? await db.feriado.findUnique({ where: { id } }) : null;
  if (!holiday) throw new AppError("FERIADO_NO_ENCONTRADO", "No existe ese feriado.", 404);
  await db.$transaction(async (tx) => {
    await tx.feriado.delete({ where: { id } });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "FERIADO_ELIMINADO",
      entidad: "feriado",
      entidadId: id,
      datos: { fecha: asText(holiday.fecha), descripcion: holiday.descripcion },
      ip: actor.ip,
    });
  });
}
