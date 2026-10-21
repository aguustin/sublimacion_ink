import { z } from "zod";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { lockWindowCalendar, windowStartFor } from "./cancellation-window.service";

const dispatchDateSchema = z.strictObject({
  fecha: z.iso.datetime({ offset: true, error: "Indicá fecha y hora." }).transform((value) => new Date(value)),
  motivo: z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().max(500).optional()),
});

/**
 * Solo pedidos con pago y todavía no listos ni despachados: son los únicos en los que la ventana
 * de 48 h define el cargo por cancelar (RN-23).
 */
const STATES_WITH_DISPATCH_DATE = ["CONFIRMADO", "EN_PRODUCCION"] as const;

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * El administrador confirma o cambia la fecha comprometida de despacho (o de disponibilidad para
 * retiro, D-32). Se guarda desde cuándo cancelar tiene cargo, se registra el cambio y se avisa al
 * cliente (RN-14, RN-30, CA-18).
 */
export async function setDispatchDate(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { fecha, motivo } = dispatchDateSchema.parse(input);
  const now = new Date();
  if (fecha <= now) throw new AppError("FECHA_INVALIDA", "La fecha comprometida tiene que ser futura.", 422);

  return db.$transaction(async (tx) => {
    // Primero el calendario y después el pedido, en el mismo orden que el recálculo por fechas
    // excluidas (INC-10.2): así no se traban y la fecha nueva ve las exclusiones definitivas.
    await lockWindowCalendar(tx);
    const isUuid = /^[0-9a-f-]{36}$/i.test(pedidoId);
    if (isUuid) await tx.$queryRaw`SELECT id FROM pedido WHERE id = ${pedidoId}::uuid FOR UPDATE`;
    const order = isUuid ? await tx.pedido.findUnique({ where: { id: pedidoId }, include: { cliente: { select: { email: true } } } }) : null;
    if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
    if (!(STATES_WITH_DISPATCH_DATE as readonly string[]).includes(order.estado)) {
      throw new AppError("ESTADO_INVALIDO", "Solo se confirma la fecha de pedidos confirmados que todavía no están listos.", 409, {
        estado: order.estado,
      });
    }

    // RN-30: 48 h que cuentan antes de la fecha, sin las fechas excluidas por el admin.
    const windowStart = await windowStartFor(tx, fecha);
    // RN-14: confirmada con 48 h o menos, la marca queda fija aunque después se posponga la fecha.
    const within48Hours = windowStart <= now;
    const fixed = order.ventanaCargoFija || within48Hours;

    const updated = await tx.pedido.update({
      where: { id: pedidoId },
      data: { fechaDespachoComprometida: fecha, inicioVentanaCargo: windowStart, ventanaCargoFija: fixed },
    });
    await tx.cambioFechaDespacho.create({
      data: {
        pedidoId,
        fechaAnterior: order.fechaDespachoComprometida,
        fechaNueva: fecha,
        inicioVentanaAnterior: order.inicioVentanaCargo,
        inicioVentanaNuevo: windowStart,
        confirmadaCon48hOMenos: within48Hours,
        motivo,
        autorId: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: order.fechaDespachoComprometida ? "FECHA_DESPACHO_CAMBIADA" : "FECHA_DESPACHO_CONFIRMADA",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { fechaAnterior: order.fechaDespachoComprometida?.toISOString() ?? null, fechaNueva: fecha.toISOString(), ventanaCargoFija: fixed },
      ip: actor.ip,
    });

    const delivery = order.modalidadEntrega === "RETIRO" ? "va a estar listo para retirar" : "se despacha";
    await enqueueNotification(tx, {
      usuarioId: order.clienteId,
      email: order.cliente.email,
      tipo: order.fechaDespachoComprometida ? "FECHA_DESPACHO_CAMBIADA" : "FECHA_DESPACHO_CONFIRMADA",
      titulo: `Pedido #${order.numero}: fecha confirmada`,
      mensaje: fixed
        ? `Tu pedido ${delivery} el ${dateFormat.format(fecha)}. Desde ahora, cancelarlo tiene un cargo por servicio.`
        : `Tu pedido ${delivery} el ${dateFormat.format(fecha)}. Si lo cancelás a partir del ${dateFormat.format(windowStart)}, se cobra un cargo por servicio.`,
    });

    return {
      fechaDespachoComprometida: updated.fechaDespachoComprometida,
      inicioVentanaCargo: updated.inicioVentanaCargo,
      ventanaCargoFija: updated.ventanaCargoFija,
    };
  });
}
