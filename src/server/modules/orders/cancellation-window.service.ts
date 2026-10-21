import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { storeTimeZone } from "./holidays.service";
import { cancellationWindowStart, recalculatedWindowStart } from "./order.policy";

// Fechas excluidas de la ventana de 48 h (RN-30, F-09, INC-10.2). Agregar o quitar una fecha
// recalcula, en una sola transacción, el inicio de la ventana de los pedidos afectados, registra
// cada cambio y encola el aviso: o pasa todo o no pasa nada, y un reintento no avisa dos veces.

type Tx = Prisma.TransactionClient;

/** RN-30: pedidos cuya ventana se recalcula: con fecha comprometida, todavía no despachados y sin la marca fija. */
const RECALCULABLE_STATES = ["CONFIRMADO", "EN_PRODUCCION"] as const;

const dateSchema = z.iso.date("Indicá la fecha (AAAA-MM-DD).");
const addSchema = z.strictObject({ fecha: dateSchema, motivo: z.string().trim().min(3, "Indicá el motivo.").max(300) });
const previewSchema = z.strictObject({ fecha: dateSchema, accion: z.enum(["AGREGAR", "QUITAR"], "Indicá si se agrega o se quita.") });

const asDate = (date: string) => new Date(`${date}T00:00:00Z`);
const asText = (date: Date) => date.toISOString().slice(0, 10);

const dateTimeFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * Todos los cambios del calendario de la ventana (fechas excluidas y fechas comprometidas) se
 * serializan con este bloqueo: cada recálculo ve las exclusiones definitivas de los demás.
 */
export async function lockWindowCalendar(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ventana_cargo_48h'))`;
}

async function excludedDays(db: DbClient): Promise<Set<string>> {
  const rows = await db.diaExcluidoVentana.findMany({ select: { fecha: true } });
  return new Set(rows.map((row) => asText(row.fecha)));
}

/** RN-30: inicio de la ventana de una fecha comprometida, con las exclusiones vigentes. */
export async function windowStartFor(db: DbClient, dispatchDate: Date): Promise<Date> {
  return cancellationWindowStart(dispatchDate, await excludedDays(db), await storeTimeZone(db));
}

type Change = {
  pedidoId: string;
  numero: number;
  clienteId: string;
  email: string;
  fechaDespacho: Date;
  inicioAnterior: Date;
  inicioNuevo: Date;
  /** El inicio nuevo es el momento del aviso: la ventana se abre ya, sin cargos retroactivos (T-133). */
  desdeAhora: boolean;
};

/** Pedidos cuya ventana cambiaría con estas exclusiones, y cómo (vista previa y recálculo usan lo mismo). */
async function affectedOrders(tx: DbClient, exclusions: Set<string>, now: Date, lock: boolean): Promise<Change[]> {
  const timeZone = await storeTimeZone(tx);
  // Bloqueo en orden fijo para no trabarse con otra transacción que bloquee los mismos pedidos.
  if (lock) {
    await (tx as Tx).$queryRaw`
      SELECT id FROM pedido
      WHERE estado IN ('CONFIRMADO', 'EN_PRODUCCION') AND fecha_despacho_comprometida IS NOT NULL AND NOT ventana_cargo_fija
      ORDER BY id FOR UPDATE`;
  }
  const orders = await tx.pedido.findMany({
    where: {
      estado: { in: [...RECALCULABLE_STATES] },
      fechaDespachoComprometida: { not: null },
      inicioVentanaCargo: { not: null },
      ventanaCargoFija: false,
    },
    select: {
      id: true,
      numero: true,
      clienteId: true,
      fechaDespachoComprometida: true,
      inicioVentanaCargo: true,
      cliente: { select: { email: true } },
    },
    orderBy: { numero: "asc" },
  });
  return orders.flatMap((order) => {
    const computed = cancellationWindowStart(order.fechaDespachoComprometida!, exclusions, timeZone);
    const next = recalculatedWindowStart(order.inicioVentanaCargo!, computed, now);
    return next
      ? [
          {
            pedidoId: order.id,
            numero: order.numero,
            clienteId: order.clienteId,
            email: order.cliente.email,
            fechaDespacho: order.fechaDespachoComprometida!,
            inicioAnterior: order.inicioVentanaCargo!,
            inicioNuevo: next,
            desdeAhora: next.getTime() === now.getTime(),
          },
        ]
      : [];
  });
}

function withChange(exclusions: Set<string>, fecha: string, accion: "AGREGAR" | "QUITAR"): Set<string> {
  const next = new Set(exclusions);
  if (accion === "AGREGAR") next.add(fecha);
  else next.delete(fecha);
  return next;
}

/** Fechas excluidas, con el nombre de quien las registró. */
export async function listExclusions(db: Db = getDb()) {
  const exclusions = await db.diaExcluidoVentana.findMany({ orderBy: { fecha: "asc" } });
  const authors = await db.usuario.findMany({
    where: { id: { in: [...new Set(exclusions.map((row) => row.creadoPorId))] } },
    select: { id: true, nombre: true },
  });
  const names = new Map(authors.map((author) => [author.id, author.nombre]));
  return exclusions.map((row) => ({ ...row, fecha: asText(row.fecha), creadoPor: names.get(row.creadoPorId) ?? null }));
}

/** F-09 paso 1: qué pedidos cambiarían y cómo, sin modificar nada. */
export async function previewExclusionChange(input: unknown, db: Db = getDb()) {
  const { fecha, accion } = previewSchema.parse(input);
  const current = await excludedDays(db);
  if (accion === "AGREGAR" && current.has(fecha)) throw new AppError("FECHA_YA_EXCLUIDA", "Esa fecha ya está excluida.", 409);
  if (accion === "QUITAR" && !current.has(fecha)) throw new AppError("FECHA_NO_EXCLUIDA", "Esa fecha no está excluida.", 404);
  const changes = await affectedOrders(db, withChange(current, fecha, accion), new Date(), false);
  return {
    fecha,
    accion,
    pedidos: changes.map(({ pedidoId, numero, fechaDespacho, inicioAnterior, inicioNuevo, desdeAhora }) => ({
      pedidoId,
      numero,
      fechaDespacho,
      inicioAnterior,
      inicioNuevo,
      desdeAhora,
    })),
  };
}

/**
 * F-09 pasos 2 y 4: aplica el recálculo. Cada pedido se actualiza con un UPDATE condicional sobre el
 * inicio anterior, con su registro y su aviso en la misma transacción (outbox, 16.3).
 */
async function applyChanges(
  tx: Tx,
  actor: Actor,
  fecha: string,
  causa: "FECHA_EXCLUIDA_AGREGADA" | "FECHA_EXCLUIDA_QUITADA",
  exclusions: Set<string>,
) {
  const now = new Date();
  const changes = await affectedOrders(tx, exclusions, now, true);
  let recalculados = 0;
  const notified = new Set<string>();
  for (const change of changes) {
    const updated = await tx.pedido.updateMany({
      where: { id: change.pedidoId, inicioVentanaCargo: change.inicioAnterior, ventanaCargoFija: false },
      data: { inicioVentanaCargo: change.inicioNuevo },
    });
    if (updated.count === 0) continue;
    recalculados++;
    notified.add(change.clienteId);
    const opened = change.desdeAhora;
    const notification = await enqueueNotification(tx, {
      usuarioId: change.clienteId,
      email: change.email,
      tipo: "VENTANA_CARGO_CAMBIADA",
      titulo: `Pedido #${change.numero}: cambió desde cuándo cancelar tiene cargo`,
      mensaje: opened
        ? "Por un cambio en el calendario de la tienda, desde ahora cancelar tu pedido tiene un cargo por servicio. No se aplica nada retroactivo."
        : `Por un cambio en el calendario de la tienda, cancelar tu pedido tiene un cargo por servicio a partir del ${dateTimeFormat.format(change.inicioNuevo)}.`,
    });
    await tx.cambioVentanaCargo.create({
      data: {
        pedidoId: change.pedidoId,
        causa,
        fechaExcluida: asDate(fecha),
        inicioAnterior: change.inicioAnterior,
        inicioNuevo: change.inicioNuevo,
        autorId: actor.id,
        notificacionId: notification.id,
        creadoEn: now,
      },
    });
  }
  // Lo realmente aplicado: un cliente con varios pedidos afectados cuenta una vez.
  return { recalculados, clientesNotificados: notified.size };
}

export async function addExclusion(actor: Actor, input: unknown, db: Db = getDb()) {
  const { fecha, motivo } = addSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      await lockWindowCalendar(tx);
      const exclusion = await tx.diaExcluidoVentana.create({ data: { fecha: asDate(fecha), motivo, creadoPorId: actor.id } });
      const { recalculados, clientesNotificados } = await applyChanges(tx, actor, fecha, "FECHA_EXCLUIDA_AGREGADA", await excludedDays(tx));
      await recordAudit(tx, {
        actorId: actor.id,
        accion: "FECHA_EXCLUIDA_AGREGADA",
        entidad: "dia_excluido_ventana",
        entidadId: exclusion.id,
        datos: { fecha, motivo, recalculados },
        ip: actor.ip,
      });
      return { exclusion, recalculados, clientesNotificados };
    });
  } catch (error) {
    // Un reintento de la misma fecha no recalcula ni avisa otra vez.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new AppError("FECHA_YA_EXCLUIDA", "Esa fecha ya está excluida.", 409);
    throw error;
  }
}

export async function removeExclusion(actor: Actor, fecha: unknown, db: Db = getDb()) {
  const date = dateSchema.parse(fecha);
  return db.$transaction(async (tx) => {
    await lockWindowCalendar(tx);
    const removed = await tx.diaExcluidoVentana.deleteMany({ where: { fecha: asDate(date) } });
    if (removed.count === 0) throw new AppError("FECHA_NO_EXCLUIDA", "Esa fecha no está excluida.", 404);
    const { recalculados, clientesNotificados } = await applyChanges(tx, actor, date, "FECHA_EXCLUIDA_QUITADA", await excludedDays(tx));
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "FECHA_EXCLUIDA_QUITADA",
      entidad: "dia_excluido_ventana",
      datos: { fecha: date, recalculados },
      ip: actor.ip,
    });
    return { fecha: date, recalculados, clientesNotificados };
  });
}
