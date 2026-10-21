import { z } from "zod";
import { Prisma, type Pedido } from "@/generated/prisma/client";
import { formatPesos } from "@/lib/money";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { consumeCoupon, couponCodeSchema, previewCoupon } from "@/server/modules/coupons/coupon.service";
import { couponDiscount } from "@/server/modules/coupons/coupon.policy";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { contactSentence, getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { findOwnAddress } from "@/server/modules/users/profile.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { cashReservationExpiry } from "./holidays.service";
import { confirmationWithoutPaymentData, lockOrder, NO_PAYMENT_REQUIRED } from "./order-payment.service";
import { depositAmount, DEPOSIT_PERCENT, onlinePaymentExpiry } from "./order.policy";

/** Motivo del historial: el cupón cubre los productos y solo queda el envío, que se cobra como saldo. */
export const NO_DEPOSIT_REQUIRED = "SIN_SENA_REQUERIDA";
import { transitionOrder } from "./order-transitions";

// Personalizados (F-03, INC-08.1): solicitud, cotización manual (D-10), aceptación con inicio del
// plazo (RN-17), rechazo y reemisión de una cotización vencida (D-42). El cobro de la seña y del
// saldo es de INC-08.2; los materiales no se reservan ni se exigen (D-14, D-18).

type Tx = Prisma.TransactionClient;

const MAX_REFERENCES = 10;

const dateOnly = (message: string) => z.iso.date(message).transform((value) => new Date(`${value}T00:00:00.000Z`));

const requestSchema = z
  .strictObject({
    varianteId: z.uuid("Elegí el producto base."),
    cantidad: z.number().int().min(1, "La cantidad mínima es 1.").max(1000),
    descripcion: z.string().trim().min(10, "Contanos qué querés (al menos 10 caracteres).").max(2000),
    fechaDeseada: dateOnly("Indicá la fecha deseada."),
    modalidadEntrega: z.enum(["RETIRO", "ENVIO"], "Elegí cómo vas a recibir el pedido."),
    direccionId: z.uuid("Elegí la dirección de envío.").optional(),
    referencias: z.array(z.uuid()).max(MAX_REFERENCES, `Podés adjuntar hasta ${MAX_REFERENCES} archivos.`).default([]),
  })
  .refine((data) => data.modalidadEntrega !== "ENVIO" || data.direccionId, { path: ["direccionId"], message: "Elegí la dirección de envío." });

const quoteSchema = z.strictObject({
  precioUnitarioCentavos: z.number().int().positive("Indicá el precio."),
  /** D-48: obligatorio con envío y prohibido con retiro. */
  costoEnvioCentavos: z.number().int().min(0).optional(),
  fechaEntregaPropuesta: dateOnly("Indicá la fecha estimada de entrega."),
  detalle: z.string().trim().min(3, "Indicá el detalle de la cotización.").max(2000),
});

const acceptSchema = z.strictObject({
  cotizacionId: z.uuid(),
  modalidadCierre: z.enum(["ONLINE", "EFECTIVO"], "Elegí cómo vas a pagar la seña."),
  codigoCupon: couponCodeSchema.optional(),
  /** Lo que el cliente vio en la vista previa: si cambió, se rechaza. */
  totalEsperadoCentavos: z.number().int().min(0),
});

const rejectSchema = z.strictObject({ cotizacionId: z.uuid() });

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });

const idempotencyKeySchema = z.uuid("Falta la clave de idempotencia de la solicitud.");

async function notify(tx: Tx, order: Pick<Pedido, "clienteId">, tipo: string, titulo: string, mensaje: string) {
  const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
  await enqueueNotification(tx, { usuarioId: order.clienteId, email: client.email, tipo, titulo, mensaje });
}

/** RF-22: solicitud de personalización. El pedido nace en `EN_DEFINICION`, sin stock retenido ni plazo (F-03). */
export async function createCustomRequest(user: SessionUser, input: unknown, idempotencyKey: string | null, db: Db = getDb()) {
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) throw new AppError("CLAVE_IDEMPOTENCIA_REQUERIDA", "Falta la clave de idempotencia de la solicitud.", 400);
  const data = requestSchema.parse(input);

  const existing = await db.pedido.findUnique({ where: { clienteId_claveIdempotencia: { clienteId: user.id, claveIdempotencia: key.data } } });
  if (existing) return { pedidoId: existing.id, numero: existing.numero, creado: false };

  const variant = await db.variante.findFirst({
    where: { id: data.varianteId, activa: true, producto: { activo: true, tipo: "PERSONALIZABLE" } },
    include: { producto: true },
  });
  if (!variant) throw new AppError("PRODUCTO_NO_DISPONIBLE", "Ese producto no se puede personalizar.", 409);
  const address = data.modalidadEntrega === "ENVIO" ? await findOwnAddress(db, user.id, data.direccionId!) : null;

  // Solo referencias propias, activas y subidas como referencia (16.1).
  const references = await db.archivo.findMany({
    where: { id: { in: data.referencias }, propietarioClienteId: user.id, estado: "ACTIVO", contexto: "REFERENCIA" },
    select: { id: true },
  });
  if (references.length !== new Set(data.referencias).size)
    throw new AppError("ARCHIVO_NO_ENCONTRADO", "No encontramos alguno de los archivos de referencia.", 404);

  try {
    return await db.$transaction(async (tx) => {
      const order = await tx.pedido.create({
        data: {
          clienteId: user.id,
          tipo: "PERSONALIZADO",
          estado: "EN_DEFINICION",
          // Se elige al aceptar la cotización; con envío solo puede ser online (RN-13).
          modalidadCierre: "ONLINE",
          modalidadEntrega: data.modalidadEntrega,
          direccionEnvio: address
            ? {
                calle: address.calle,
                ciudad: address.ciudad,
                provincia: address.provincia,
                codigoPostal: address.codigoPostal,
                referencias: address.referencias,
              }
            : undefined,
          subtotalProductosCentavos: 0,
          totalCentavos: 0,
          claveIdempotencia: key.data,
          solicitud: { create: { varianteId: variant.id, cantidad: data.cantidad, descripcion: data.descripcion, fechaDeseada: data.fechaDeseada } },
          referencias: { create: references.map(({ id }) => ({ archivoId: id })) },
        },
      });
      await tx.historialEstadoPedido.create({ data: { pedidoId: order.id, estadoNuevo: "EN_DEFINICION", actorId: user.id } });
      await recordAudit(tx, {
        actorId: user.id,
        accion: "SOLICITUD_PERSONALIZADA_CREADA",
        entidad: "pedido",
        entidadId: order.id,
        datos: { numero: order.numero, varianteId: variant.id, cantidad: data.cantidad, referencias: references.length },
      });
      await notify(
        tx,
        order,
        "SOLICITUD_RECIBIDA",
        `Pedido #${order.numero}: solicitud recibida`,
        "Recibimos tu solicitud. Te avisamos cuando tengamos la cotización.",
      );
      return { pedidoId: order.id, numero: order.numero, creado: true };
    });
  } catch (error) {
    // Dos envíos simultáneos con la misma clave: el segundo devuelve el pedido del primero.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const order = await db.pedido.findUnique({ where: { clienteId_claveIdempotencia: { clienteId: user.id, claveIdempotencia: key.data } } });
      if (order) return { pedidoId: order.id, numero: order.numero, creado: false };
    }
    throw error;
  }
}

function currentQuote(db: DbClient, pedidoId: string) {
  return db.cotizacion.findFirst({ where: { pedidoId, estado: "PROPUESTA" } });
}

function assertDefining(order: Pedido) {
  if (order.tipo !== "PERSONALIZADO" || order.estado !== "EN_DEFINICION") {
    throw new AppError("ESTADO_INVALIDO", "El pedido no está esperando una cotización.", 409, { estado: order.estado });
  }
}

/** Crea la cotización vigente de un pedido en definición; la anterior, si la había, queda reemplazada. */
async function issueQuote(tx: Tx, actor: Actor, order: Pedido, input: z.infer<typeof quoteSchema>) {
  const shipping = order.modalidadEntrega === "ENVIO";
  if (shipping !== (input.costoEnvioCentavos !== undefined)) {
    throw new AppError("VALIDACION", "Los datos enviados no son válidos.", 422, [
      { campo: "costoEnvioCentavos", mensaje: shipping ? "Indicá el costo del envío." : "Un pedido con retiro no lleva costo de envío." },
    ]);
  }
  const request = await tx.solicitudPersonalizacion.findUniqueOrThrow({ where: { pedidoId: order.id } });
  const now = new Date();
  await tx.cotizacion.updateMany({ where: { pedidoId: order.id, estado: "PROPUESTA" }, data: { estado: "REEMPLAZADA", respondidaEn: now } });
  const quote = await tx.cotizacion.create({
    data: {
      pedidoId: order.id,
      precioUnitarioCentavos: input.precioUnitarioCentavos,
      precioProductosCentavos: input.precioUnitarioCentavos * request.cantidad,
      costoEnvioCentavos: input.costoEnvioCentavos ?? null,
      fechaEntregaPropuesta: input.fechaEntregaPropuesta,
      detalle: input.detalle,
      autorId: actor.id,
      creadoEn: now,
    },
  });
  await recordAudit(tx, {
    actorId: actor.id,
    accion: "COTIZACION_EMITIDA",
    entidad: "pedido",
    entidadId: order.id,
    datos: { cotizacionId: quote.id, precioProductosCentavos: quote.precioProductosCentavos, costoEnvioCentavos: quote.costoEnvioCentavos },
    ip: actor.ip,
  });
  const envio = quote.costoEnvioCentavos === null ? "" : ` más ${formatPesos(quote.costoEnvioCentavos)} de envío`;
  await notify(
    tx,
    order,
    "COTIZACION_EMITIDA",
    `Pedido #${order.numero}: cotización lista`,
    `Tu pedido cuesta ${formatPesos(quote.precioProductosCentavos)}${envio}. Para confirmarlo, aceptá la cotización y pagá la seña del ${DEPOSIT_PERCENT} %.`,
  );
  return quote;
}

/** D-10: el admin emite la cotización, o la reemplaza mientras el pedido sigue en definición. */
export async function quoteCustomOrder(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const data = quoteSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId);
    assertDefining(order);
    return issueQuote(tx, actor, order, data);
  });
}

/** Lo que el cliente ve antes de aceptar: productos, cupón, envío, total y seña (RN-21). */
async function pricingFor(
  db: DbClient,
  clienteId: string,
  quote: { precioProductosCentavos: number; costoEnvioCentavos: number | null },
  codigoCupon?: string,
) {
  const descuentoCuponCentavos = codigoCupon ? (await previewCoupon(clienteId, codigoCupon, quote.precioProductosCentavos, db)).descuentoCentavos : 0;
  const productosCobradosCentavos = quote.precioProductosCentavos - descuentoCuponCentavos;
  const costoEnvioCentavos = quote.costoEnvioCentavos ?? 0;
  return {
    precioProductosCentavos: quote.precioProductosCentavos,
    descuentoCuponCentavos,
    costoEnvioCentavos,
    totalCentavos: productosCobradosCentavos + costoEnvioCentavos,
    senaCentavos: depositAmount(productosCobradosCentavos),
  };
}

export async function previewQuoteAcceptance(user: SessionUser, pedidoId: string, codigoCupon: unknown, db: Db = getDb()) {
  const order = /^[0-9a-f-]{36}$/i.test(pedidoId) ? await db.pedido.findFirst({ where: { id: pedidoId, clienteId: user.id } }) : null;
  if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  assertDefining(order);
  const quote = await currentQuote(db, order.id);
  if (!quote) throw new AppError("SIN_COTIZACION", "Todavía no hay una cotización para este pedido.", 409);
  const code = codigoCupon ? couponCodeSchema.parse(codigoCupon) : undefined;
  return { cotizacionId: quote.id, ...(await pricingFor(db, user.id, quote, code)) };
}

/**
 * El cliente acepta la cotización vigente (F-03 paso 4): recién ahora empieza el plazo (RN-17),
 * con los mecanismos existentes: 30 min online (RN-22) o 24 h hábiles en efectivo con retiro
 * (RN-13, RN-29). El cupón se consume en la misma transacción (F-08).
 */
export async function acceptCustomQuote(user: SessionUser, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { cotizacionId, modalidadCierre, codigoCupon, totalEsperadoCentavos } = acceptSchema.parse(input);
  if (modalidadCierre === "EFECTIVO" && !user.telefono) {
    throw new AppError("TELEFONO_REQUERIDO", "Para reservar con pago en efectivo necesitamos tu teléfono.", 422);
  }
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId, { clienteId: user.id });
    assertDefining(order);
    if (modalidadCierre === "EFECTIVO" && order.modalidadEntrega === "ENVIO") {
      throw new AppError("EFECTIVO_SOLO_RETIRO", "El pago en efectivo es solo con retiro en el local.", 422);
    }
    const quote = await currentQuote(tx, order.id);
    if (!quote || quote.id !== cotizacionId) {
      throw new AppError("COTIZACION_DESACTUALIZADA", "La cotización cambió. Revisala antes de aceptar.", 409);
    }

    const coupon = codigoCupon ? await consumeCoupon(tx, { codigo: codigoCupon, clienteId: user.id, pedidoId: order.id }) : null;
    const discount = coupon ? couponDiscount(coupon.montoCentavos, quote.precioProductosCentavos) : 0;
    const costoEnvioCentavos = quote.costoEnvioCentavos ?? 0;
    const totalCentavos = quote.precioProductosCentavos - discount + costoEnvioCentavos;
    if (totalCentavos !== totalEsperadoCentavos) {
      throw new AppError("PRECIO_CAMBIADO", "El total cambió. Revisalo antes de aceptar.", 409, { totalCentavos });
    }
    const senaCentavos = depositAmount(quote.precioProductosCentavos - discount);

    const request = await tx.solicitudPersonalizacion.findUniqueOrThrow({
      where: { pedidoId: order.id },
      include: { variante: { include: { producto: true } } },
    });
    const variant = request.variante;
    const options = [variant.material, variant.medida, variant.color, variant.talle].filter(Boolean).join(" · ");
    await tx.itemPedido.create({
      data: {
        pedidoId: order.id,
        varianteId: variant.id,
        descripcion: `${variant.producto.nombre} personalizado${options ? ` · ${options}` : ""}`,
        precioUnitarioCentavos: quote.precioUnitarioCentavos,
        cantidad: request.cantidad,
      },
    });

    const now = new Date();
    const free = totalCentavos === 0; // RN-32
    // El cupón cubre los productos y solo queda el envío: la seña es $0 y no se cobra (no hay pagos
    // de $0). El pedido se confirma y el envío queda como saldo, online antes del despacho (D-48).
    const noDeposit = !free && senaCentavos === 0;
    const online = modalidadCierre === "ONLINE";
    const confirmedNow = free || noDeposit;
    const estado = confirmedNow ? "CONFIRMADO" : online ? "PENDIENTE_PAGO" : "RESERVADO";
    const venceEn = confirmedNow ? null : online ? onlinePaymentExpiry(now) : await cashReservationExpiry(tx, now);
    // `at`: el plazo y el recálculo por feriados parten del instante de la aceptación (RN-17, RN-29).
    const accepted = await transitionOrder(tx, {
      pedidoId: order.id,
      from: "EN_DEFINICION",
      to: estado,
      actorId: user.id,
      motivo: free ? NO_PAYMENT_REQUIRED : noDeposit ? NO_DEPOSIT_REQUIRED : "COTIZACION_ACEPTADA",
      at: now,
      data: {
        modalidadCierre,
        ...(confirmedNow ? confirmationWithoutPaymentData() : { venceEn }),
        subtotalProductosCentavos: quote.precioProductosCentavos,
        cuponId: coupon?.id ?? null,
        descuentoCuponCentavos: discount,
        costoEnvioCentavos,
        totalCentavos,
        porcentajeSena: DEPOSIT_PERCENT,
        senaCentavos,
      },
    });
    if (!accepted) throw new AppError("ESTADO_INVALIDO", "El pedido cambió de estado. Volvé a cargarlo.", 409);
    await tx.cotizacion.update({ where: { id: quote.id }, data: { estado: "ACEPTADA", respondidaPorId: user.id, respondidaEn: now } });

    await recordAudit(tx, {
      actorId: user.id,
      accion: "COTIZACION_ACEPTADA",
      entidad: "pedido",
      entidadId: order.id,
      datos: { cotizacionId: quote.id, modalidadCierre, totalCentavos, senaCentavos, cuponId: coupon?.id ?? null },
    });
    await notify(
      tx,
      order,
      confirmedNow ? "PEDIDO_CONFIRMADO" : "COTIZACION_ACEPTADA",
      `Pedido #${order.numero}: cotización aceptada`,
      free
        ? "Tu pedido no tiene importe a pagar: quedó confirmado."
        : noDeposit
          ? `Tu pedido quedó confirmado sin seña. El envío (${formatPesos(totalCentavos)}) se paga online antes del despacho.`
          : `La seña es de ${formatPesos(senaCentavos)} y vence el ${dateFormat.format(venceEn!)}${online ? "" : "; se paga en efectivo en el local"}.${online ? "" : contactSentence(await getStoreContact(tx))}`,
    );
    return { estado, venceEn, totalCentavos, senaCentavos };
  });
}

/** El cliente rechaza la cotización: el pedido sigue en definición, sin plazo, a la espera de otra. */
export async function rejectCustomQuote(user: SessionUser, pedidoId: string, input: unknown, db: Db = getDb()) {
  const { cotizacionId } = rejectSchema.parse(input);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, pedidoId, { clienteId: user.id });
    assertDefining(order);
    const rejected = await tx.cotizacion.updateMany({
      where: { id: cotizacionId, pedidoId: order.id, estado: "PROPUESTA" },
      data: { estado: "RECHAZADA", respondidaPorId: user.id, respondidaEn: new Date() },
    });
    if (rejected.count === 0) throw new AppError("COTIZACION_DESACTUALIZADA", "La cotización cambió. Volvé a cargar el pedido.", 409);
    await recordAudit(tx, { actorId: user.id, accion: "COTIZACION_RECHAZADA", entidad: "pedido", entidadId: order.id, datos: { cotizacionId } });
  });
}

/**
 * D-42: un personalizado que venció por falta de seña no se reabre. El admin crea un pedido nuevo,
 * vinculado al original, con la solicitud y las referencias copiadas y una cotización nueva; el
 * plazo empieza recién cuando el cliente la acepta (RN-17). Un original se reemite una sola vez.
 */
export async function reissueCustomQuote(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const data = quoteSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const original = await lockOrder(tx, pedidoId);
      const last = await tx.historialEstadoPedido.findFirst({ where: { pedidoId: original.id }, orderBy: { creadoEn: "desc" } });
      const expiredUnpaid = last?.estadoNuevo === "VENCIDO" && (last.motivo === "VENCIMIENTO_RESERVA" || last.motivo === "VENCIMIENTO_PAGO_ONLINE");
      if (original.tipo !== "PERSONALIZADO" || original.estado !== "VENCIDO" || !expiredUnpaid) {
        throw new AppError("REEMISION_NO_PERMITIDA", "Solo se reemite la cotización de un personalizado vencido por falta de seña.", 409);
      }
      const request = await tx.solicitudPersonalizacion.findUniqueOrThrow({ where: { pedidoId: original.id } });
      const references = await tx.referenciaPedido.findMany({
        where: { pedidoId: original.id, archivo: { estado: "ACTIVO" } },
        select: { archivoId: true },
      });

      const order = await tx.pedido.create({
        data: {
          clienteId: original.clienteId,
          tipo: "PERSONALIZADO",
          estado: "EN_DEFINICION",
          modalidadCierre: "ONLINE",
          modalidadEntrega: original.modalidadEntrega,
          direccionEnvio: original.direccionEnvio ?? undefined,
          subtotalProductosCentavos: 0,
          totalCentavos: 0,
          pedidoOrigenId: original.id,
          claveIdempotencia: `reemision:${original.id}`,
          solicitud: {
            create: {
              varianteId: request.varianteId,
              cantidad: request.cantidad,
              descripcion: request.descripcion,
              fechaDeseada: request.fechaDeseada,
            },
          },
          referencias: { create: references },
        },
      });
      await tx.historialEstadoPedido.create({
        data: { pedidoId: order.id, estadoNuevo: "EN_DEFINICION", actorId: actor.id, motivo: "REEMISION_COTIZACION" },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        accion: "COTIZACION_REEMITIDA",
        entidad: "pedido",
        entidadId: order.id,
        datos: { pedidoOrigenId: original.id },
        ip: actor.ip,
      });
      const quote = await issueQuote(tx, actor, order, data);
      return { pedidoId: order.id, numero: order.numero, cotizacionId: quote.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("YA_REEMITIDO", "Este pedido ya se reemitió.", 409);
    }
    throw error;
  }
}

/** Datos de la solicitud y sus cotizaciones, para el detalle del pedido (cliente y admin). */
export function getCustomOrderDetails(pedidoId: string, db: Db = getDb()) {
  return db.pedido.findUnique({
    where: { id: pedidoId },
    select: {
      tipo: true,
      pedidoOrigen: { select: { id: true, numero: true } },
      reemision: { select: { id: true, numero: true } },
      solicitud: { include: { variante: { include: { producto: { select: { nombre: true } } } } } },
      referencias: {
        where: { archivo: { estado: "ACTIVO" } },
        include: { archivo: { select: { id: true, nombreOriginal: true, tipoMimeDetectado: true } } },
      },
      cotizaciones: { orderBy: { creadoEn: "asc" } },
    },
  });
}
