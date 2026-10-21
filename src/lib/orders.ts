export const ORDER_STATUS_LABELS: Record<string, string> = {
  EN_DEFINICION: "En definición",
  ENVIO_A_COTIZAR: "Esperando el costo del envío",
  ENVIO_COTIZADO: "Envío cotizado: falta tu respuesta",
  PENDIENTE_PAGO: "Pendiente de pago",
  RESERVADO: "Reservado (pago en el local)",
  CONFIRMADO: "Confirmado",
  EN_PRODUCCION: "En producción",
  LISTO_PARA_RETIRO: "Listo para retirar",
  DESPACHADO: "Despachado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  VENCIDO: "Vencido",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
  ERROR: "Error",
};

const dateTime = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function formatDateTime(date: Date | string): string {
  return dateTime.format(new Date(date));
}

/** Un pedido pendiente cuyo plazo ya pasó, aunque el proceso de vencimiento (INC-06.1) todavía no lo haya marcado. */
export function paymentWindowOpen(order: { estado: string; venceEn: Date | string | null }): boolean {
  return (
    (order.estado === "PENDIENTE_PAGO" || order.estado === "RESERVADO") &&
    order.venceEn !== null &&
    new Date(order.venceEn).getTime() > Date.now()
  );
}
