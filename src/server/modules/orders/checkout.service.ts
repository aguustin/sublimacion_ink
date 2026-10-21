import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { reserveStock } from "@/server/modules/inventory/stock-retention.service";
import { available } from "@/server/modules/inventory/stock.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { contactSentence, getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { consumeCoupon, couponCodeSchema } from "@/server/modules/coupons/coupon.service";
import { couponDiscount } from "@/server/modules/coupons/coupon.policy";
import { findOwnAddress } from "@/server/modules/users/profile.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { expireOverdueOrdersHolding } from "./expiration.service";
import { cashReservationExpiry } from "./holidays.service";
import { confirmationWithoutPaymentData, NO_PAYMENT_REQUIRED } from "./order-payment.service";
import { onlinePaymentExpiry, shippingQuoteStepExpiry } from "./order.policy";

const checkoutSchema = z
  .strictObject({
    modalidadCierre: z.enum(["ONLINE", "EFECTIVO"], "Elegí cómo vas a pagar."),
    modalidadEntrega: z.enum(["RETIRO", "ENVIO"], "Elegí cómo vas a recibir el pedido."),
    /** Dirección de la libreta del cliente, obligatoria con envío (RF-03). */
    direccionId: z.uuid("Elegí la dirección de envío.").optional(),
    /** Cupón de compensación propio (RN-20, F-08). */
    codigoCupon: couponCodeSchema.optional(),
    /** Precios que el cliente vio al confirmar (RN-27). */
    precios: z.array(z.object({ varianteId: z.uuid(), precioUnitarioCentavos: z.number().int().positive() })).max(100),
  })
  .refine((data) => data.modalidadEntrega !== "ENVIO" || data.direccionId, { path: ["direccionId"], message: "Elegí la dirección de envío." });

const idempotencyKeySchema = z.uuid("Falta la clave de idempotencia de la solicitud.");

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export type CheckoutResult = { pedidoId: string; numero: number; creado: boolean };

/**
 * Confirma el carrito como pedido (sección 8.1 y 8.2). Todo ocurre en una transacción: si falta
 * stock o cambió un precio, no se crea el pedido ni se retiene nada. Repetir la solicitud con la
 * misma clave devuelve el mismo pedido (RF-21). Con envío, el pedido espera la cotización de la
 * tienda sin retener stock (F-10, D-45): se retiene al aceptarla.
 */
export async function checkout(user: SessionUser, input: unknown, idempotencyKey: string | null, db: Db = getDb()): Promise<CheckoutResult> {
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) throw new AppError("CLAVE_IDEMPOTENCIA_REQUERIDA", "Falta la clave de idempotencia de la solicitud.", 400);
  const data = checkoutSchema.parse(input);

  const existing = await findByKey(db, user.id, key.data);
  if (existing) return { ...existing, creado: false };

  const shipping = data.modalidadEntrega === "ENVIO";
  if (shipping && data.modalidadCierre === "EFECTIVO") {
    throw new AppError("EFECTIVO_SOLO_RETIRO", "El pago en efectivo es solo con retiro en el local.", 422);
  }
  if (data.modalidadCierre === "EFECTIVO" && !user.telefono) {
    throw new AppError("TELEFONO_REQUERIDO", "Para reservar con pago en efectivo necesitamos tu teléfono.", 422);
  }
  const address = shipping ? await findOwnAddress(db, user.id, data.direccionId!) : null;

  const placeOrder = async (): Promise<CheckoutResult> => {
    try {
      return await db.$transaction(async (tx) => {
        const cart = await tx.carrito.findUnique({
          where: { usuarioId: user.id },
          include: { items: { include: { variante: { include: { producto: true } } }, orderBy: { creadoEn: "asc" } } },
        });
        const items = cart?.items ?? [];
        if (items.length === 0) throw new AppError("CARRITO_VACIO", "Tu carrito está vacío.", 422);

        for (const { variante } of items) {
          const purchasable = variante.activa && variante.producto.activo && variante.producto.tipo === "ESTANDAR";
          if (!purchasable || variante.precioCentavos === null) {
            throw new AppError("PRODUCTO_NO_DISPONIBLE", `«${variante.producto.nombre}» ya no está a la venta. Quitalo del carrito.`, 409, {
              varianteId: variante.id,
            });
          }
        }

        // RN-27: se cobra el precio vigente, siempre que sea el que el cliente vio.
        const seen = new Map(data.precios.map((price) => [price.varianteId, price.precioUnitarioCentavos]));
        const changed = items.filter(({ variante }) => seen.get(variante.id) !== variante.precioCentavos);
        if (changed.length > 0) {
          throw new AppError("PRECIO_CAMBIADO", "Algunos precios cambiaron. Revisá el nuevo total antes de confirmar.", 409, {
            precios: changed.map(({ variante }) => ({ varianteId: variante.id, precioUnitarioCentavos: variante.precioCentavos })),
          });
        }

        // D-45: no se retiene stock mientras se cotiza el envío, pero no se acepta un pedido que hoy no se puede cumplir.
        const missing = shipping ? items.find(({ variante, cantidad }) => available(variante) < cantidad) : undefined;
        if (missing) {
          throw new AppError("STOCK_INSUFICIENTE", `No hay stock suficiente de «${missing.variante.producto.nombre}».`, 409, {
            varianteId: missing.varianteId,
          });
        }

        const subtotal = items.reduce((sum, { variante, cantidad }) => sum + variante.precioCentavos! * cantidad, 0);
        const now = new Date();
        // F-08: el cupón se consume en esta misma transacción; si otro pedido lo usó, se revierte todo.
        const pedidoId = crypto.randomUUID();
        const coupon = data.codigoCupon ? await consumeCoupon(tx, { codigo: data.codigoCupon, clienteId: user.id, pedidoId }) : null;
        const discount = coupon ? couponDiscount(coupon.montoCentavos, subtotal) : 0;
        const online = data.modalidadCierre === "ONLINE";
        const total = subtotal - discount;
        // RN-32: con retiro, un total final de $0 se confirma sin pasar por el pago. Con envío el
        // total todavía no incluye el costo del envío, así que se decide al aceptar la cotización.
        const free = !shipping && total === 0;
        const estado = shipping ? "ENVIO_A_COTIZAR" : free ? "CONFIRMADO" : online ? "PENDIENTE_PAGO" : "RESERVADO";
        const order = await tx.pedido.create({
          data: {
            id: pedidoId,
            clienteId: user.id,
            estado,
            modalidadCierre: data.modalidadCierre,
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
            ...(free
              ? confirmationWithoutPaymentData()
              : { venceEn: shipping ? shippingQuoteStepExpiry(now) : online ? onlinePaymentExpiry(now) : await cashReservationExpiry(tx, now) }),
            subtotalProductosCentavos: subtotal,
            cuponId: coupon?.id,
            descuentoCuponCentavos: discount,
            totalCentavos: total,
            claveIdempotencia: key.data,
            items: {
              create: items.map(({ variante, cantidad }) => ({
                varianteId: variante.id,
                descripcion: describe(variante),
                precioUnitarioCentavos: variante.precioCentavos!,
                cantidad,
              })),
            },
          },
        });

        // RN-01, RN-05: retención atómica de todos los ítems; si uno no alcanza, se revierte todo.
        if (!shipping)
          await reserveStock(
            tx,
            order.id,
            items.map(({ varianteId, cantidad }) => ({ varianteId, cantidad })),
          );

        // Mismo instante desde el que se calculó `vence_en`: el recálculo por feriados parte de acá (RN-29).
        await tx.historialEstadoPedido.create({
          data: { pedidoId: order.id, estadoNuevo: estado, actorId: user.id, motivo: free ? NO_PAYMENT_REQUIRED : undefined, creadoEn: now },
        });
        await tx.itemCarrito.deleteMany({ where: { carritoId: cart!.id } });
        await recordAudit(tx, {
          actorId: user.id,
          accion: "PEDIDO_CREADO",
          entidad: "pedido",
          entidadId: order.id,
          datos: { numero: order.numero, estado, totalCentavos: order.totalCentavos, cuponId: coupon?.id ?? null, descuentoCuponCentavos: discount },
        });
        await enqueueNotification(tx, {
          usuarioId: user.id,
          email: user.email,
          tipo: shipping ? "ENVIO_A_COTIZAR" : free ? "PEDIDO_CONFIRMADO" : online ? "PEDIDO_PENDIENTE_PAGO" : "RESERVA_CREADA",
          titulo: `Pedido #${order.numero} ${free ? "confirmado" : "registrado"}`,
          mensaje: free
            ? "Tu pedido no tiene importe a pagar: quedó confirmado. Te avisamos cuando esté listo para retirar."
            : shipping
              ? `Te enviamos el costo del envío antes del ${dateFormat.format(order.venceEn!)}. El stock se reserva cuando aceptes la cotización.`
              : online
                ? `Completá el pago antes del ${dateFormat.format(order.venceEn!)}; después el pedido vence.`
                : `Reservamos tu pedido. Pagalo en efectivo en el local antes del ${dateFormat.format(order.venceEn!)}; después la reserva vence.${contactSentence(await getStoreContact(tx))}`,
        });

        return { pedidoId: order.id, numero: order.numero, creado: true };
      });
    } catch (error) {
      // Dos solicitudes simultáneas con la misma clave: la segunda devuelve el pedido de la primera.
      // Falla por la clave única o, si usaba un cupón, porque la primera ya lo consumió (F-08).
      const duplicate =
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
        (error instanceof AppError && error.code === "CUPON_INVALIDO");
      if (duplicate) {
        const order = await findByKey(db, user.id, key.data);
        if (order) return { ...order, creado: false };
      }
      throw error;
    }
  };

  try {
    return await placeOrder();
  } catch (error) {
    // Vencimiento oportunista (14.5): si falta stock porque lo retiene un pedido ya vencido que el
    // proceso periódico todavía no procesó, se vence ese pedido y se reintenta una sola vez.
    const varianteId =
      error instanceof AppError && error.code === "STOCK_INSUFICIENTE"
        ? (error.details as { varianteId?: string } | undefined)?.varianteId
        : undefined;
    if (varianteId && (await expireOverdueOrdersHolding(varianteId, db)) > 0) return placeOrder();
    throw error;
  }
}

async function findByKey(db: Db, clienteId: string, key: string) {
  const order = await db.pedido.findUnique({
    where: { clienteId_claveIdempotencia: { clienteId, claveIdempotencia: key } },
    select: { id: true, numero: true },
  });
  return order && { pedidoId: order.id, numero: order.numero };
}

function describe(variant: {
  material: string | null;
  medida: string | null;
  color: string | null;
  talle: string | null;
  producto: { nombre: string };
}) {
  const options = [variant.material, variant.medida, variant.color, variant.talle].filter(Boolean).join(" · ");
  return options ? `${variant.producto.nombre} · ${options}` : variant.producto.nombre;
}
