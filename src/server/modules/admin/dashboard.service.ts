import { unreadForStore } from "@/server/modules/chat/chat.service";
import { getInventoryOverview } from "@/server/modules/inventory/stock.service";
import { getDb, type Db } from "@/server/shared/db";

/** Reservas que vencen en este plazo se muestran «por vencer». */
const RESERVATION_WARNING_MS = 24 * 3_600_000;

/** Estados en los que el pedido todavía requiere algo de la tienda o del cliente. */
const OPEN_STATES = [
  "EN_DEFINICION",
  "ENVIO_A_COTIZAR",
  "ENVIO_COTIZADO",
  "PENDIENTE_PAGO",
  "RESERVADO",
  "CONFIRMADO",
  "EN_PRODUCCION",
  "LISTO_PARA_RETIRO",
  "DESPACHADO",
] as const;

/**
 * Panel inicial (RF-45): pedidos abiertos por estado, reservas por vencer, diseños esperando la
 * aprobación del cliente, mensajes sin leer, stock bajo y cargos o devoluciones pendientes de arreglo.
 */
export async function getAdminDashboard(db: Db = getDb()) {
  const now = new Date();
  const [byState, expiring, designs, unread, inventory, charges, refunds] = await Promise.all([
    db.pedido.groupBy({ by: ["estado"], where: { estado: { in: [...OPEN_STATES] } }, _count: { _all: true } }),
    db.pedido.count({ where: { estado: "RESERVADO", venceEn: { gt: now, lte: new Date(now.getTime() + RESERVATION_WARNING_MS) } } }),
    db.diseno.count({ where: { estado: "PENDIENTE_APROBACION" } }),
    unreadForStore(db),
    getInventoryOverview({ onlyLow: true }, db),
    db.ajusteEconomico.count({ where: { estado: "PENDIENTE_ARREGLO" } }),
    db.reembolso.count({ where: { estado: { in: ["PENDIENTE", "PENDIENTE_ARREGLO"] } } }),
  ]);
  const counts = new Map(byState.map((row) => [row.estado, row._count._all]));
  return {
    pedidosPorEstado: OPEN_STATES.map((estado) => ({ estado, cantidad: counts.get(estado) ?? 0 })).filter((row) => row.cantidad > 0),
    reservasPorVencer: expiring,
    disenosPendientes: designs,
    mensajesSinLeer: unread,
    stockBajo: inventory.variantes.length + inventory.materiales.length,
    cargosPendientes: charges,
    devolucionesPendientes: refunds,
  };
}
