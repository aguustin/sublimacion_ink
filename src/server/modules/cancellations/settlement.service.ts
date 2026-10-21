import { z } from "zod";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { assertSimulatedPaymentsEnabled } from "@/server/modules/orders/order-payment.service";
import { simulatedPaymentProvider, type PaymentProvider } from "@/server/modules/payments/payment-provider";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

// Cierre de lo que deja una cancelación: reembolsos online simulados (RF-42), devoluciones y
// cargos en efectivo arreglados con el cliente (RN-18) y el costo real estimado (RF-53).

const note = z.string().trim().min(3, "Agregá una nota.").max(1000);

const closeAdjustmentSchema = z.strictObject({
  resultado: z.enum(["COBRADO", "CONDONADO", "INCOBRABLE"], "Elegí el resultado."),
  nota: note,
});
const closeRefundSchema = z.strictObject({ nota: note });
const estimatedCostSchema = z.strictObject({ costoRealEstimadoCentavos: z.number().int().min(0).max(100_000_000).nullable() });

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

async function findRefund(db: Db, id: string) {
  const refund = isUuid(id) ? await db.reembolso.findUnique({ where: { id } }) : null;
  if (!refund) throw new AppError("REEMBOLSO_NO_ENCONTRADO", "No encontramos ese reembolso.", 404);
  return refund;
}

async function findAdjustment(db: Db, id: string) {
  const adjustment = isUuid(id) ? await db.ajusteEconomico.findUnique({ where: { id } }) : null;
  if (!adjustment) throw new AppError("AJUSTE_NO_ENCONTRADO", "No encontramos ese cargo.", 404);
  return adjustment;
}

/** El admin ejecuta el reembolso online ya calculado (RF-42). Dos ejecuciones simultáneas devuelven una sola vez. */
export async function executeRefund(
  actor: Actor,
  id: string,
  { db = getDb(), provider = simulatedPaymentProvider }: { db?: Db; provider?: PaymentProvider } = {},
) {
  assertSimulatedPaymentsEnabled();
  const refund = await findRefund(db, id);
  if (refund.estado !== "PENDIENTE") throw new AppError("REEMBOLSO_NO_PENDIENTE", "Este reembolso no está pendiente de ejecutar.", 409);
  return db.$transaction(async (tx) => {
    // Primero se marca (UPDATE condicional) y después se llama al proveedor: si otro lo ejecutó, no se repite.
    const claimed = await tx.reembolso.updateMany({
      where: { id, estado: "PENDIENTE" },
      data: { estado: "REALIZADO_SIMULADO", cerradoPorId: actor.id, cerradoEn: new Date() },
    });
    if (claimed.count === 0) throw new AppError("REEMBOLSO_NO_PENDIENTE", "Este reembolso no está pendiente de ejecutar.", 409);
    const { referencia } = await provider.refund({ pagoId: refund.pagoId, importeCentavos: refund.importeCentavos });
    const done = await tx.reembolso.update({ where: { id }, data: { referenciaExterna: referencia } });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "REEMBOLSO_EJECUTADO",
      entidad: "pedido",
      entidadId: refund.pedidoId,
      datos: { reembolsoId: id, importeCentavos: refund.importeCentavos, simulado: provider.simulated },
      ip: actor.ip,
    });
    return done;
  });
}

/** RN-18: una devolución en efectivo se cierra como `DEVUELTO`, con nota. */
export async function closeCashRefund(actor: Actor, id: string, input: unknown, db: Db = getDb()) {
  const { nota } = closeRefundSchema.parse(input);
  const refund = await findRefund(db, id);
  return db.$transaction(async (tx) => {
    const closed = await tx.reembolso.updateMany({
      where: { id, estado: "PENDIENTE_ARREGLO" },
      data: { estado: "DEVUELTO", notaCierre: nota, cerradoPorId: actor.id, cerradoEn: new Date() },
    });
    if (closed.count === 0) throw new AppError("REEMBOLSO_NO_PENDIENTE", "Esta devolución no está pendiente de arreglo.", 409);
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "DEVOLUCION_EFECTIVO_CERRADA",
      entidad: "pedido",
      entidadId: refund.pedidoId,
      datos: { reembolsoId: id, importeCentavos: refund.importeCentavos, nota },
      ip: actor.ip,
    });
    return tx.reembolso.findUniqueOrThrow({ where: { id } });
  });
}

/** RN-18: un cargo pendiente de arreglo se cierra como cobrado, condonado o incobrable, con nota. */
export async function closeAdjustment(actor: Actor, id: string, input: unknown, db: Db = getDb()) {
  const { resultado, nota } = closeAdjustmentSchema.parse(input);
  const adjustment = await findAdjustment(db, id);
  return db.$transaction(async (tx) => {
    const closed = await tx.ajusteEconomico.updateMany({
      where: { id, estado: "PENDIENTE_ARREGLO" },
      data: { estado: resultado, notaCierre: nota, cerradoPorId: actor.id, cerradoEn: new Date() },
    });
    if (closed.count === 0) throw new AppError("AJUSTE_NO_PENDIENTE", "Este cargo no está pendiente de arreglo.", 409);
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "CARGO_CERRADO",
      entidad: "pedido",
      entidadId: adjustment.pedidoId,
      datos: { ajusteId: id, resultado, nota },
      ip: actor.ip,
    });
    return tx.ajusteEconomico.findUniqueOrThrow({ where: { id } });
  });
}

/** RF-53: referencia interna editable; no cambia el cargo comercial. */
export async function updateEstimatedRealCost(actor: Actor, id: string, input: unknown, db: Db = getDb()) {
  const { costoRealEstimadoCentavos } = estimatedCostSchema.parse(input);
  const adjustment = await findAdjustment(db, id);
  return db.$transaction(async (tx) => {
    const updated = await tx.ajusteEconomico.update({ where: { id }, data: { costoRealEstimadoCentavos } });
    await recordAudit(tx, {
      actorId: actor.id,
      accion: "COSTO_REAL_ESTIMADO_ACTUALIZADO",
      entidad: "pedido",
      entidadId: adjustment.pedidoId,
      datos: { ajusteId: id, anterior: adjustment.costoRealEstimadoCentavos, nuevo: costoRealEstimadoCentavos },
      ip: actor.ip,
    });
    return updated;
  });
}
