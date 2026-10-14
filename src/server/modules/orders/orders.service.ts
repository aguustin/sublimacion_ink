import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

const detailInclude = {
  items: { orderBy: { id: "asc" } },
  pagos: { orderBy: { creadoEn: "asc" } },
  historial: { orderBy: { creadoEn: "asc" } },
} satisfies Prisma.PedidoInclude;

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** Pedidos del cliente, del más reciente al más antiguo (RF-35). */
export function listCustomerOrders(clienteId: string, db: Db = getDb()) {
  return db.pedido.findMany({
    where: { clienteId },
    orderBy: { creadoEn: "desc" },
    take: 100,
    select: { id: true, numero: true, estado: true, totalCentavos: true, venceEn: true, modalidadCierre: true, creadoEn: true },
  });
}

/** Un pedido ajeno se trata como inexistente: 404 sin revelar que existe (T-40). */
export async function getCustomerOrder(clienteId: string, pedidoId: string, db: Db = getDb()) {
  const order = isUuid(pedidoId) ? await db.pedido.findFirst({ where: { id: pedidoId, clienteId }, include: detailInclude }) : null;
  if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  return order;
}

const adminListSchema = z.object({
  estado: z
    .enum(["EN_DEFINICION", "PENDIENTE_PAGO", "RESERVADO", "CONFIRMADO", "EN_PRODUCCION", "LISTO_PARA_RETIRO", "DESPACHADO", "ENTREGADO", "CANCELADO", "VENCIDO"])
    .optional()
    .catch(undefined),
  pagina: z.coerce.number().int().min(1).catch(1),
});

const ADMIN_PAGE_SIZE = 50;

/** Pedidos para la administración, filtrables por estado (RF-36). */
export async function listAdminOrders(input: unknown, db: Db = getDb()) {
  const { estado, pagina } = adminListSchema.parse(input);
  const where = estado ? { estado } : {};
  const [pedidos, total] = await Promise.all([
    db.pedido.findMany({
      where,
      orderBy: { creadoEn: "desc" },
      skip: (pagina - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: { cliente: { select: { nombre: true, email: true, telefono: true } } },
    }),
    db.pedido.count({ where }),
  ]);
  return { pedidos, total, pagina };
}

export async function getAdminOrder(pedidoId: string, db: Db = getDb()) {
  const order = isUuid(pedidoId)
    ? await db.pedido.findUnique({
        where: { id: pedidoId },
        include: { ...detailInclude, cliente: { select: { nombre: true, email: true, telefono: true } } },
      })
    : null;
  if (!order) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  return order;
}
