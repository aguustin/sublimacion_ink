import { z } from "zod";
import type { Pedido, Prisma, RolCancelacion } from "@/generated/prisma/client";
import { formatPesos } from "@/lib/money";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { issueCompensationCoupon, restoreCoupon } from "@/server/modules/coupons/coupon.service";
import { releaseOrderRetentions } from "@/server/modules/inventory/stock-retention.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { lockOrder } from "@/server/modules/orders/order-payment.service";
import { transitionOrder } from "@/server/modules/orders/order-transitions";
import { contactSentence, getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { estimatedRealCost, evaluateCancellation, type CancellationBreakdown, type CancellationDecision } from "./cancellation.policy";

// Cancelación por el cliente (F-04) y por la tienda (F-05). Todo en una transacción con el pedido
// bloqueado: estado, stock, desglose, un único cargo (RN-24), reembolsos, auditoría y aviso.

type Tx = Prisma.TransactionClient;

const reason = z.string().trim().min(3, "Indicá el motivo.").max(500);

const clientCancelSchema = z.strictObject({
  motivo: reason,
  /** Lo que el cliente vio en la vista previa: si cambió, se rechaza (T-111). */
  cargoEsperadoCentavos: z.number().int().min(0),
  aReembolsarEsperadoCentavos: z.number().int().min(0),
});

const storeCancelSchema = z.strictObject({ motivo: reason });

/** Datos del pedido que usa la política. Los pagos aprobados son lo que se devuelve. */
async function evaluate(db: DbClient, order: Pedido, rol: RolCancelacion): Promise<CancellationDecision> {
  const pagos = await db.pago.findMany({ where: { pedidoId: order.id, estado: "APROBADO" }, select: { concepto: true, importeCentavos: true } });
  return evaluateCancellation({
    rol,
    estado: order.estado,
    tipo: order.tipo,
    subtotalProductosCentavos: order.subtotalProductosCentavos,
    descuentoCuponCentavos: order.descuentoCuponCentavos,
    envioCentavos: order.costoEnvioCentavos,
    porcentajeCargo: order.porcentajeCargoCancelacion,
    inicioVentanaCargo: order.inicioVentanaCargo,
    ventanaCargoFija: order.ventanaCargoFija,
    pagos,
    now: new Date(),
  });
}

function assertAllowed(decision: CancellationDecision, contact?: { emailContacto: string | null; telefonoContacto: string | null }) {
  if (!decision.permitida) throw new AppError(decision.codigo, decision.mensaje, 409, contact && { contacto: contact });
  return decision;
}

/** El cliente responde la cotización del envío desde su propio flujo (F-10), que distingue el caso de D-49. */
function assertNotAwaitingShippingAnswer(order: Pedido) {
  if (order.estado === "ENVIO_COTIZADO") {
    throw new AppError("ESTADO_INVALIDO", "Respondé la cotización del envío: ahí podés cancelar sin cargo.", 409);
  }
}

function describeConsequences(rol: RolCancelacion, desglose: CancellationBreakdown, liberadas: number): string {
  const parts = [liberadas > 0 ? "stock liberado" : "sin stock retenido"];
  if (desglose.cargoCentavos > 0) parts.push(`cargo de ${formatPesos(desglose.cargoCentavos)}`);
  parts.push(desglose.aReembolsarCentavos > 0 ? `devolución de ${formatPesos(desglose.aReembolsarCentavos)}` : "sin devolución");
  if (rol === "TIENDA") parts.push("cupón de compensación (RN-20)");
  return parts.join("; ");
}

/**
 * Aplica una cancelación ya evaluada. La usan la cancelación del cliente, la de la tienda y el
 * rechazo del envío cotizado (D-47, D-49), así todas dejan el mismo registro.
 */
export async function applyCancellation(
  tx: Tx,
  order: Pedido,
  {
    rol,
    actor,
    motivo,
    motivoHistorial = rol === "TIENDA" ? "CANCELACION_TIENDA" : "CANCELACION_CLIENTE",
    decision,
  }: {
    rol: RolCancelacion;
    actor: Actor;
    motivo: string;
    /** Código del motivo en el historial de estados. */
    motivoHistorial?: string;
    decision: Extract<CancellationDecision, { permitida: true }>;
  },
) {
  const actorId = actor.id;
  const { regla, dentroVentana, desglose } = decision;
  const now = new Date();
  const cancelled = await transitionOrder(tx, {
    pedidoId: order.id,
    from: order.estado,
    to: "CANCELADO",
    actorId,
    motivo: motivoHistorial,
    at: now,
  });
  if (!cancelled) throw new AppError("ESTADO_INVALIDO", "El pedido cambió de estado. Volvé a cargarlo.", 409);

  const liberadas = await releaseOrderRetentions(tx, order.id, "CANCELACION");
  // RN-20: el cupón que usó el pedido vuelve a estar activo una sola vez; si cancela la tienda,
  // además se emite uno nuevo sobre el subtotal original de los productos (RN-19, D-34).
  await restoreCoupon(tx, order.id);
  const coupon = rol === "TIENDA" ? await issueCompensationCoupon(tx, order) : null;
  const cancelacion = await tx.cancelacion.create({
    data: {
      pedidoId: order.id,
      solicitadaPorId: actorId,
      rol,
      motivo,
      estadoPrevio: order.estado,
      dentroVentana,
      // RN-30, T-135: qué ventana regía al cancelar, tal como estaba guardada.
      inicioVentanaCargo: order.inicioVentanaCargo,
      regla,
      ...desglose,
      consecuencias: describeConsequences(rol, desglose, liberadas),
      creadoEn: now,
    },
  });

  // RN-24: un único cargo; el índice único parcial de la base lo garantiza también ante reintentos.
  if (desglose.cargoCentavos > 0) {
    await tx.ajusteEconomico.create({
      data: {
        pedidoId: order.id,
        tipo: regla === "RN_21" ? "RETENCION_SENA" : "CARGO_SERVICIO_CANCELACION",
        baseCentavos: regla === "RN_21" ? desglose.senaPagadaCentavos : desglose.productosCobradosCentavos,
        porcentaje: desglose.porcentajeAplicado,
        importeCentavos: desglose.cargoCentavos,
        // RN-18: si lo pagado no cubre el cargo, hay que arreglarlo con el cliente.
        estado: desglose.totalPagadoCentavos >= desglose.cargoCentavos ? "REGISTRADO" : "PENDIENTE_ARREGLO",
        costoRealEstimadoCentavos: estimatedRealCost(desglose.productosCobradosCentavos),
      },
    });
  }

  // Se devuelve primero lo último que se pagó (en personalizados, el saldo antes que la seña, RN-21).
  let remaining = desglose.aReembolsarCentavos;
  const pagos = await tx.pago.findMany({ where: { pedidoId: order.id, estado: "APROBADO" }, orderBy: { creadoEn: "desc" } });
  for (const pago of pagos) {
    if (remaining === 0) break;
    const importeCentavos = Math.min(remaining, pago.importeCentavos);
    remaining -= importeCentavos;
    const online = pago.medio === "ONLINE";
    await tx.reembolso.create({
      data: {
        pedidoId: order.id,
        pagoId: pago.id,
        importeCentavos,
        incluyeEnvio: desglose.incluyeEnvio,
        // Online: reembolso simulado que ejecuta el admin (RF-42). Efectivo: arreglo (RN-18).
        estado: online ? "PENDIENTE" : "PENDIENTE_ARREGLO",
        simulado: online && pago.simulado,
        motivo: `Cancelación ${rol === "TIENDA" ? "por la tienda" : "por el cliente"}`,
      },
    });
  }

  await recordAudit(tx, {
    actorId,
    accion: "PEDIDO_CANCELADO",
    entidad: "pedido",
    entidadId: order.id,
    datos: {
      cancelacionId: cancelacion.id,
      rol,
      regla,
      cargoCentavos: desglose.cargoCentavos,
      aReembolsarCentavos: desglose.aReembolsarCentavos,
      cuponEmitidoId: coupon?.id ?? null,
    },
    ip: actor.ip,
  });

  const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
  const cash = pagos.some((pago) => pago.medio === "EFECTIVO");
  const refund =
    desglose.aReembolsarCentavos === 0
      ? ""
      : cash
        ? ` Te vamos a contactar para devolverte ${formatPesos(desglose.aReembolsarCentavos)}.${contactSentence(await getStoreContact(tx))}`
        : ` Te devolvemos ${formatPesos(desglose.aReembolsarCentavos)} (reembolso simulado).`;
  await enqueueNotification(tx, {
    usuarioId: order.clienteId,
    email: client.email,
    tipo: "PEDIDO_CANCELADO",
    titulo: `Pedido #${order.numero} cancelado`,
    mensaje:
      (rol === "TIENDA" ? `La tienda canceló el pedido #${order.numero}: ${motivo}.` : `Cancelaste el pedido #${order.numero}.`) +
      (desglose.cargoCentavos > 0 ? ` Se aplicó un cargo de ${formatPesos(desglose.cargoCentavos)}.` : "") +
      refund,
  });
  return cancelacion;
}

/** Lo que el cliente ve antes de confirmar (F-04 paso 3): regla, desglose y contacto de la tienda. */
export async function previewClientCancellation(user: SessionUser, pedidoId: string, db: Db = getDb()) {
  const order = /^[0-9a-f-]{36}$/i.test(pedidoId) ? await db.pedido.findFirst({ where: { id: pedidoId, clienteId: user.id } }) : null;
  if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  assertNotAwaitingShippingAnswer(order);
  const contact = await getStoreContact(db);
  const decision = assertAllowed(await evaluate(db, order, "CLIENTE"), contact);
  return { ...decision, contacto: contact };
}

export async function cancelByClient(user: SessionUser, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { motivo, cargoEsperadoCentavos, aReembolsarEsperadoCentavos } = clientCancelSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId, { clienteId: user.id });
    assertNotAwaitingShippingAnswer(order);
    const decision = assertAllowed(await evaluate(tx, order, "CLIENTE"), await getStoreContact(tx));
    if (decision.desglose.cargoCentavos !== cargoEsperadoCentavos || decision.desglose.aReembolsarCentavos !== aReembolsarEsperadoCentavos) {
      throw new AppError("CONDICIONES_CAMBIARON", "Las condiciones de la cancelación cambiaron. Revisalas antes de confirmar.", 409, decision);
    }
    return applyCancellation(tx, order, { rol: "CLIENTE", actor: { id: user.id }, motivo, decision });
  });
}

/** F-05: la tienda cancela en cualquier estado no final, sin cargo y con devolución total (RN-19). */
export async function cancelByStore(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { motivo } = storeCancelSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);
    const decision = assertAllowed(await evaluate(tx, order, "TIENDA"));
    return applyCancellation(tx, order, { rol: "TIENDA", actor, motivo, decision });
  });
}

/** Para el rechazo del envío cotizado (F-10): misma evaluación y registro que cualquier cancelación. */
export async function evaluateForShippingDecline(tx: Tx, order: Pedido, rol: RolCancelacion) {
  return assertAllowed(await evaluate(tx, order, rol));
}
