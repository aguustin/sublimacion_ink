import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { reserveStock } from "@/server/modules/inventory/stock-retention.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { cashReservationExpiry, onlinePaymentExpiry } from "./order.policy";

const checkoutSchema = z.strictObject({
  modalidadCierre: z.enum(["ONLINE", "EFECTIVO"], "Elegí cómo vas a pagar."),
  modalidadEntrega: z.enum(["RETIRO", "ENVIO"], "Elegí cómo vas a recibir el pedido."),
  /** Precios que el cliente vio al confirmar (RN-27). */
  precios: z.array(z.object({ varianteId: z.uuid(), precioUnitarioCentavos: z.number().int().positive() })).max(100),
});

const idempotencyKeySchema = z.uuid("Falta la clave de idempotencia de la solicitud.");

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export type CheckoutResult = { pedidoId: string; numero: number; creado: boolean };

/**
 * Confirma el carrito como pedido con retiro en el local (sección 8.1 y 8.2). Todo ocurre en
 * una transacción: si falta stock o cambió un precio, no se crea el pedido ni se retiene nada.
 * Repetir la solicitud con la misma clave devuelve el mismo pedido (RF-21).
 */
export async function checkout(
  user: SessionUser,
  input: unknown,
  idempotencyKey: string | null,
  db: Db = getDb(),
): Promise<CheckoutResult> {
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) throw new AppError("CLAVE_IDEMPOTENCIA_REQUERIDA", "Falta la clave de idempotencia de la solicitud.", 400);
  const data = checkoutSchema.parse(input);

  const existing = await findByKey(db, user.id, key.data);
  if (existing) return { ...existing, creado: false };

  // D-06 (opción B) está acordada, pero su flujo depende de D-45 a D-49.
  if (data.modalidadEntrega === "ENVIO") {
    throw new AppError("ENVIO_NO_DISPONIBLE", "Por ahora los pedidos se retiran en el local.", 422);
  }
  if (data.modalidadCierre === "EFECTIVO" && !user.telefono) {
    throw new AppError("TELEFONO_REQUERIDO", "Para reservar con pago en efectivo necesitamos tu teléfono.", 422);
  }

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

      const subtotal = items.reduce((sum, { variante, cantidad }) => sum + variante.precioCentavos! * cantidad, 0);
      const now = new Date();
      const online = data.modalidadCierre === "ONLINE";
      const estado = online ? "PENDIENTE_PAGO" : "RESERVADO";
      const order = await tx.pedido.create({
        data: {
          clienteId: user.id,
          estado,
          modalidadCierre: data.modalidadCierre,
          modalidadEntrega: "RETIRO",
          venceEn: online ? onlinePaymentExpiry(now) : cashReservationExpiry(now),
          subtotalProductosCentavos: subtotal,
          totalCentavos: subtotal,
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
      await reserveStock(tx, order.id, items.map(({ varianteId, cantidad }) => ({ varianteId, cantidad })));

      await tx.historialEstadoPedido.create({ data: { pedidoId: order.id, estadoNuevo: estado, actorId: user.id } });
      await tx.itemCarrito.deleteMany({ where: { carritoId: cart!.id } });
      await recordAudit(tx, {
        actorId: user.id,
        accion: "PEDIDO_CREADO",
        entidad: "pedido",
        entidadId: order.id,
        datos: { numero: order.numero, estado, totalCentavos: subtotal },
      });
      await enqueueNotification(tx, {
        usuarioId: user.id,
        email: user.email,
        tipo: online ? "PEDIDO_PENDIENTE_PAGO" : "RESERVA_CREADA",
        titulo: `Pedido #${order.numero} registrado`,
        mensaje: online
          ? `Completá el pago antes del ${dateFormat.format(order.venceEn!)}; después el pedido vence.`
          : `Reservamos tu pedido. Pagalo en efectivo en el local antes del ${dateFormat.format(order.venceEn!)}; después la reserva vence.`,
      });

      return { pedidoId: order.id, numero: order.numero, creado: true };
    });
  } catch (error) {
    // Dos solicitudes simultáneas con la misma clave: la segunda devuelve el pedido de la primera.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const order = await findByKey(db, user.id, key.data);
      if (order) return { ...order, creado: false };
    }
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

function describe(variant: { material: string | null; medida: string | null; color: string | null; talle: string | null; producto: { nombre: string } }) {
  const options = [variant.material, variant.medida, variant.color, variant.talle].filter(Boolean).join(" · ");
  return options ? `${variant.producto.nombre} · ${options}` : variant.producto.nombre;
}
