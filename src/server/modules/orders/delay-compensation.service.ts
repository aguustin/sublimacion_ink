import { z } from "zod";
import { formatPesos } from "@/lib/money";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { isDispatchLate } from "./delivery.service";
import { lockOrder } from "./order-payment.service";

const compensationSchema = z.strictObject({
  importeCentavos: z.number("Indicá el importe.").int("El importe va en centavos.").positive("El importe tiene que ser mayor que cero."),
  justificacion: z.string("Indicá el motivo.").trim().min(1, "Indicá el motivo.").max(500),
  autorizadoPor: z.string("Indicá quién la autorizó.").trim().min(1, "Indicá quién la autorizó.").max(100),
});

/**
 * Compensación por demora en el envío (RN-04, D-05, T-107): la carga el admin a mano, con motivo,
 * importe y quién la autorizó, y genera su devolución. No hay cálculo automático ni umbral.
 * T-107 (confirmado en v1.36): el importe no puede superar lo pagado que todavía no se devolvió.
 */
export async function registerDelayCompensation(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const data = compensationSchema.parse(input);
  return db.$transaction(async (tx) => {
    // Con el pedido bloqueado, dos cargas simultáneas no pueden devolver dos veces lo mismo.
    const order = await lockOrder(tx, pedidoId);
    const entrega = await tx.entrega.findUnique({ where: { pedidoId }, select: { despachadoEn: true } });
    if (order.modalidadEntrega !== "ENVIO" || !["DESPACHADO", "ENTREGADO"].includes(order.estado)) {
      throw new AppError("ESTADO_INVALIDO", "La compensación por demora se carga en un envío ya despachado.", 409, { estado: order.estado });
    }
    if (!isDispatchLate(order.fechaDespachoComprometida, entrega?.despachadoEn)) {
      throw new AppError("SIN_DEMORA", "El pedido se despachó dentro de la fecha comprometida: no hay demora que compensar.", 409);
    }

    // Lo que queda por devolver de cada pago aprobado: su importe menos lo ya reembolsado.
    const pagos = await tx.pago.findMany({
      where: { pedidoId, estado: "APROBADO" },
      orderBy: { creadoEn: "desc" },
      include: { reembolsos: { select: { importeCentavos: true } } },
    });
    const available = pagos.map((pago) => ({
      pago,
      restante: pago.importeCentavos - pago.reembolsos.reduce((sum, refund) => sum + refund.importeCentavos, 0),
    }));
    const totalAvailable = available.reduce((sum, entry) => sum + Math.max(0, entry.restante), 0);
    if (data.importeCentavos > totalAvailable) {
      throw new AppError(
        "IMPORTE_EXCEDE_PAGADO",
        `La compensación no puede superar lo pagado que todavía no se devolvió (${formatPesos(totalAvailable)}).`,
        422,
        {
          disponibleCentavos: totalAvailable,
        },
      );
    }

    const ajuste = await tx.ajusteEconomico.create({
      data: {
        pedidoId,
        tipo: "COMPENSACION_DEMORA",
        baseCentavos: totalAvailable,
        importeCentavos: data.importeCentavos,
        estado: "REGISTRADO",
        justificacion: data.justificacion,
        autorizadoPor: data.autorizadoPor,
        autorId: actor.id,
      },
    });

    // Igual que en la cancelación: primero lo último que se pagó. Online, reembolso simulado que
    // ejecuta el admin (RF-42); en efectivo, se arregla con el cliente (RN-18).
    let remaining = data.importeCentavos;
    for (const { pago, restante } of available) {
      if (remaining === 0) break;
      if (restante <= 0) continue;
      const importeCentavos = Math.min(remaining, restante);
      remaining -= importeCentavos;
      const online = pago.medio === "ONLINE";
      await tx.reembolso.create({
        data: {
          pedidoId,
          pagoId: pago.id,
          ajusteId: ajuste.id,
          importeCentavos,
          incluyeEnvio: false,
          estado: online ? "PENDIENTE" : "PENDIENTE_ARREGLO",
          simulado: online && pago.simulado,
          motivo: "Compensación por demora en el envío",
        },
      });
    }

    await recordAudit(tx, {
      actorId: actor.id,
      accion: "COMPENSACION_DEMORA_REGISTRADA",
      entidad: "pedido",
      entidadId: pedidoId,
      datos: { ajusteId: ajuste.id, importeCentavos: data.importeCentavos, justificacion: data.justificacion, autorizadoPor: data.autorizadoPor },
      ip: actor.ip,
    });
    const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
    await enqueueNotification(tx, {
      usuarioId: order.clienteId,
      email: client.email,
      tipo: "COMPENSACION_DEMORA",
      titulo: `Pedido #${order.numero}: compensación por la demora`,
      mensaje: `Por la demora en el envío te devolvemos ${formatPesos(data.importeCentavos)}. ${data.justificacion}`,
    });
    return { ajusteId: ajuste.id, importeCentavos: data.importeCentavos };
  });
}
