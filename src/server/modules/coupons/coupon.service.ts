import { z } from "zod";
import type { Pedido, Prisma } from "@/generated/prisma/client";
import { formatPesos } from "@/lib/money";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { COMPENSATION_PERCENT, compensationAmount, couponDiscount, couponExpiry, generateCouponCode, normalizeCouponCode } from "./coupon.policy";

// Cupones de compensación (RN-20, F-08): emisión cuando cancela la tienda, uso atómico en el
// checkout y restauración única cuando el pedido que lo usó se cancela o vence.

type Tx = Prisma.TransactionClient;

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });

export const couponCodeSchema = z
  .string("Ingresá el código del cupón.")
  .trim()
  .min(1, "Ingresá el código del cupón.")
  .max(20)
  .transform(normalizeCouponCode);

const invalid = () => new AppError("CUPON_INVALIDO", "El cupón no existe, no es tuyo, ya se usó o venció.", 422);

/**
 * RN-19, RN-20: un cupón por pedido cancelado por la tienda, en la misma transacción que la
 * cancelación. El índice único de `pedido_origen_id` impide emitir dos aunque se reintente.
 */
export async function issueCompensationCoupon(tx: Tx, order: Pick<Pedido, "id" | "numero" | "clienteId" | "subtotalProductosCentavos">) {
  // El 10 % de $0 (un personalizado todavía sin cotizar) no da un cupón.
  if (compensationAmount(order.subtotalProductosCentavos) === 0) return null;
  const emitidoEn = new Date();
  const coupon = await tx.cupon.create({
    data: {
      codigo: generateCouponCode(),
      clienteId: order.clienteId,
      pedidoOrigenId: order.id,
      montoCentavos: compensationAmount(order.subtotalProductosCentavos),
      porcentaje: COMPENSATION_PERCENT,
      emitidoEn,
      venceEn: couponExpiry(emitidoEn),
    },
  });
  const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
  await enqueueNotification(tx, {
    usuarioId: order.clienteId,
    email: client.email,
    tipo: "CUPON_EMITIDO",
    titulo: `Cupón de compensación por el pedido #${order.numero}`,
    mensaje: `Te regalamos un cupón de ${formatPesos(coupon.montoCentavos)} para tu próxima compra: ${coupon.codigo}. Vale hasta el ${dateFormat.format(coupon.venceEn)} y lo ves en «Mis cupones».`,
  });
  await recordAudit(tx, {
    accion: "CUPON_EMITIDO",
    entidad: "cupon",
    entidadId: coupon.id,
    datos: { pedidoOrigenId: order.id, montoCentavos: coupon.montoCentavos },
  });
  return coupon;
}

/**
 * F-08 paso 2: el uso es un UPDATE condicional en la misma transacción que crea el pedido. Si
 * dos compras usan el mismo cupón a la vez, solo una lo consigue; la otra se revierte entera.
 */
export async function consumeCoupon(tx: Tx, { codigo, clienteId, pedidoId }: { codigo: string; clienteId: string; pedidoId: string }) {
  const used = await tx.cupon.updateMany({
    where: { codigo, clienteId, estado: "ACTIVO", venceEn: { gt: new Date() } },
    data: { estado: "USADO", usadoEnPedidoId: pedidoId },
  });
  if (used.count === 0) throw invalid();
  return tx.cupon.findUniqueOrThrow({ where: { codigo } });
}

/** RN-28 [PROPUESTA]: al reactivar una reserva, su cupón tiene que seguir disponible. */
export async function reconsumeCoupon(tx: Tx, cuponId: string, pedidoId: string) {
  const used = await tx.cupon.updateMany({
    where: { id: cuponId, estado: "ACTIVO", venceEn: { gt: new Date() } },
    data: { estado: "USADO", usadoEnPedidoId: pedidoId },
  });
  if (used.count === 0) {
    throw new AppError("CUPON_NO_DISPONIBLE", "El cupón que usaba el pedido ya no está disponible: no se puede reactivar.", 409);
  }
  return tx.cupon.findUniqueOrThrow({ where: { id: cuponId } });
}

/**
 * F-08 paso 3: si el pedido que usó el cupón se cancela o vence, el cupón vuelve a estar activo
 * una sola vez, con su vencimiento original; si ya venció, queda vencido. Idempotente.
 */
export async function restoreCoupon(tx: Tx, pedidoId: string): Promise<void> {
  const now = new Date();
  const restored = await tx.cupon.updateMany({
    where: { usadoEnPedidoId: pedidoId, estado: "USADO", venceEn: { gt: now } },
    data: { estado: "ACTIVO", usadoEnPedidoId: null, restauradoEn: now },
  });
  const expired = await tx.cupon.updateMany({
    where: { usadoEnPedidoId: pedidoId, estado: "USADO", venceEn: { lte: now } },
    data: { estado: "VENCIDO", usadoEnPedidoId: null },
  });
  if (restored.count + expired.count > 0) {
    await recordAudit(tx, {
      accion: restored.count > 0 ? "CUPON_RESTAURADO" : "CUPON_VENCIDO",
      entidad: "pedido",
      entidadId: pedidoId,
    });
  }
}

/** Descuento que daría un cupón propio sobre un importe de productos (F-08 paso 1). */
export async function previewCoupon(clienteId: string, codigoInput: unknown, productosCentavos: number, db: DbClient = getDb()) {
  const codigo = couponCodeSchema.parse(codigoInput);
  const coupon = await db.cupon.findFirst({ where: { codigo, clienteId, estado: "ACTIVO", venceEn: { gt: new Date() } } });
  if (!coupon) throw invalid();
  return {
    codigo,
    montoCentavos: coupon.montoCentavos,
    venceEn: coupon.venceEn,
    descuentoCentavos: couponDiscount(coupon.montoCentavos, productosCentavos),
  };
}

/** "Mis cupones": un cupón activo cuyo plazo pasó se muestra como vencido. */
export async function listCustomerCoupons(clienteId: string, db: Db = getDb()) {
  const coupons = await db.cupon.findMany({ where: { clienteId }, orderBy: { emitidoEn: "desc" }, take: 100 });
  const now = new Date();
  return coupons.map((coupon) => ({ ...coupon, estado: coupon.estado === "ACTIVO" && coupon.venceEn <= now ? ("VENCIDO" as const) : coupon.estado }));
}

const adminListSchema = z.object({ estado: z.enum(["ACTIVO", "USADO", "VENCIDO", "ANULADO"]).optional().catch(undefined) });

/** RF-54: listado para el admin, filtrable por estado. */
export async function listAdminCoupons(input: unknown, db: Db = getDb()) {
  const { estado } = adminListSchema.parse(input);
  const now = new Date();
  const where: Prisma.CuponWhereInput =
    estado === "ACTIVO"
      ? { estado: "ACTIVO", venceEn: { gt: now } }
      : estado === "VENCIDO"
        ? { OR: [{ estado: "VENCIDO" }, { estado: "ACTIVO", venceEn: { lte: now } }] }
        : estado
          ? { estado }
          : {};
  return db.cupon.findMany({
    where,
    orderBy: { emitidoEn: "desc" },
    take: 200,
    include: { pedidoOrigen: { select: { numero: true, cliente: { select: { nombre: true, email: true } } } } },
  });
}

const voidSchema = z.strictObject({ motivo: z.string().trim().min(3, "Indicá el motivo.").max(500) });

/** RF-54: el admin anula un cupón activo, con motivo. */
export async function voidCoupon(actor: Actor, id: string, input: unknown, db: Db = getDb()) {
  const { motivo } = voidSchema.parse(input);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("CUPON_NO_ENCONTRADO", "No encontramos ese cupón.", 404);
  return db.$transaction(async (tx) => {
    const voided = await tx.cupon.updateMany({
      where: { id, estado: "ACTIVO" },
      data: { estado: "ANULADO", anuladoPorId: actor.id, motivoAnulacion: motivo },
    });
    if (voided.count === 0) {
      const exists = await tx.cupon.count({ where: { id } });
      if (!exists) throw new AppError("CUPON_NO_ENCONTRADO", "No encontramos ese cupón.", 404);
      throw new AppError("CUPON_NO_ACTIVO", "Solo se anulan cupones activos.", 409);
    }
    await recordAudit(tx, { actorId: actor.id, accion: "CUPON_ANULADO", entidad: "cupon", entidadId: id, datos: { motivo }, ip: actor.ip });
    return tx.cupon.findUniqueOrThrow({ where: { id } });
  });
}
