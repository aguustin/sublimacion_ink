import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { lockOrder } from "./order-payment.service";

const receiptSchema = z.strictObject({
  tipo: z.enum(["FACTURA", "NOTA_CREDITO"], "Indicá si es una factura o una nota de crédito."),
  letra: z
    .string("Indicá la letra del comprobante.")
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,2}$/, "La letra es una o dos letras (por ejemplo, C)."),
  puntoVenta: z.number("Indicá el punto de venta.").int().positive("El punto de venta es un número mayor que cero.").max(99999),
  numero: z.number("Indicá el número.").int().positive("El número es mayor que cero.").max(99999999),
  fechaEmision: z.iso.date("Indicá la fecha de emisión (AAAA-MM-DD).").transform((value) => new Date(`${value}T00:00:00.000Z`)),
  importeCentavos: z.number("Indicá el importe.").int("El importe va en centavos.").positive("El importe tiene que ser mayor que cero."),
  archivoId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid("El archivo no es válido.").optional()),
});

const TYPE_LABELS = { FACTURA: "factura", NOTA_CREDITO: "nota de crédito" } as const;

/**
 * Registro de un comprobante emitido fuera del sistema (RN-26, RF-56): la tienda factura con su
 * facturador y acá solo lo asienta en el pedido, con el PDF opcional que el cliente descarga.
 * Confirmado en v1.36: la nota de crédito va en un pedido cancelado que ya tiene factura.
 */
export async function registerReceipt(actor: Actor, pedidoId: string, input: unknown, db: Db = getDb()) {
  const data = receiptSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, pedidoId);
      if (data.tipo === "NOTA_CREDITO") {
        const invoiced = await tx.comprobanteExterno.count({ where: { pedidoId, tipo: "FACTURA" } });
        if (order.estado !== "CANCELADO" || invoiced === 0) {
          throw new AppError("NOTA_CREDITO_NO_PERMITIDA", "La nota de crédito se registra en un pedido cancelado que ya tiene su factura.", 409);
        }
      }
      if (data.archivoId) {
        // Solo un PDF subido por la tienda como comprobante y todavía sin asociar.
        const archivo = await tx.archivo.findFirst({
          where: { id: data.archivoId, estado: "ACTIVO", contexto: "COMPROBANTE", tipoMimeDetectado: "application/pdf", comprobante: null },
        });
        if (!archivo) throw new AppError("ARCHIVO_NO_ENCONTRADO", "No encontramos el PDF del comprobante.", 404);
      }
      const receipt = await tx.comprobanteExterno.create({ data: { pedidoId, ...data, registradoPorId: actor.id } });
      await recordAudit(tx, {
        actorId: actor.id,
        accion: "COMPROBANTE_REGISTRADO",
        entidad: "pedido",
        entidadId: pedidoId,
        datos: { comprobanteId: receipt.id, tipo: receipt.tipo, letra: receipt.letra, puntoVenta: receipt.puntoVenta, numero: receipt.numero },
        ip: actor.ip,
      });
      const client = await tx.usuario.findUniqueOrThrow({ where: { id: order.clienteId }, select: { email: true } });
      await enqueueNotification(tx, {
        usuarioId: order.clienteId,
        email: client.email,
        tipo: "COMPROBANTE_REGISTRADO",
        titulo: `Pedido #${order.numero}: ${TYPE_LABELS[receipt.tipo]}`,
        mensaje: `Registramos la ${TYPE_LABELS[receipt.tipo]} de tu pedido. La ves en el detalle del pedido.`,
      });
      return receipt;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("COMPROBANTE_DUPLICADO", "Ya hay un comprobante registrado con ese tipo, letra, punto de venta y número.", 409);
    }
    throw error;
  }
}
