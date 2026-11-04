// Matriz de estados del Documento Maestro v1.4 (sección 12): familia de color de cada estado real y
// textos para el cliente (F7). Solo presentación: no cambia estados ni reglas.

export type StatusFamily = "wait" | "active" | "done" | "error" | "neutral";

export const ORDER_FAMILY: Record<string, StatusFamily> = {
  EN_DEFINICION: "wait",
  ENVIO_A_COTIZAR: "wait",
  ENVIO_COTIZADO: "wait",
  PENDIENTE_PAGO: "wait",
  RESERVADO: "wait",
  CONFIRMADO: "active",
  EN_PRODUCCION: "active",
  LISTO_PARA_RETIRO: "done",
  DESPACHADO: "active",
  ENTREGADO: "done",
  CANCELADO: "error",
  VENCIDO: "neutral",
};

export const PAYMENT_FAMILY: Record<string, StatusFamily> = { APROBADO: "done", RECHAZADO: "error", ERROR: "error" };

export const COUPON_FAMILY: Record<string, StatusFamily> = { ACTIVO: "done", USADO: "neutral", VENCIDO: "neutral", ANULADO: "error" };

export const REFUND_FAMILY: Record<string, StatusFamily> = {
  PENDIENTE: "wait",
  REALIZADO_SIMULADO: "done",
  PENDIENTE_ARREGLO: "wait",
  DEVUELTO: "done",
};

export const CHARGE_FAMILY: Record<string, StatusFamily> = {
  REGISTRADO: "done",
  PENDIENTE_ARREGLO: "wait",
  COBRADO: "done",
  CONDONADO: "neutral",
  INCOBRABLE: "error",
};

export const DESIGN_FAMILY: Record<string, StatusFamily> = {
  SIN_PROPUESTA: "wait",
  PENDIENTE_APROBACION: "wait",
  CAMBIOS_SOLICITADOS: "wait",
  APROBADO: "done",
};

/** Cotizaciones: la del envío rechazada es neutra (D-47); la del personalizado, roja (v1.3). */
export function quoteFamily(estado: string, kind: "PERSONALIZADO" | "ENVIO"): StatusFamily {
  if (estado === "RECHAZADA") return kind === "ENVIO" ? "neutral" : "error";
  return ({ PROPUESTA: "wait", ACEPTADA: "done", REEMPLAZADA: "neutral" } as Record<string, StatusFamily>)[estado] ?? "neutral";
}

/** Textos del pedido para el cliente (F7). VENCIDO depende del motivo: ver expiredOrderLabel. */
export const ORDER_PUBLIC_LABELS: Record<string, string> = {
  EN_DEFINICION: "Definiendo tu pedido",
  ENVIO_A_COTIZAR: "Cotizando el envío",
  ENVIO_COTIZADO: "Envío cotizado",
  PENDIENTE_PAGO: "Pago pendiente",
  RESERVADO: "Reservado",
  CONFIRMADO: "Confirmado",
  EN_PRODUCCION: "En producción",
  LISTO_PARA_RETIRO: "Listo para retirar",
  DESPACHADO: "Despachado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  VENCIDO: "Vencido",
};

/** VENCIDO según el motivo guardado por el proceso de vencimiento y el tipo de pedido (v1.3). */
export function expiredOrderLabel(tipo: string, motivo: string | null | undefined): string {
  if (tipo === "PERSONALIZADO") return "Plazo de pago vencido";
  if (motivo === "VENCIMIENTO_PAGO_ONLINE") return "Pago vencido";
  if (motivo === "VENCIMIENTO_RESERVA") return "Reserva vencida";
  return ORDER_PUBLIC_LABELS.VENCIDO!;
}

/** Texto del estado del pedido para el cliente; `motivo` es el del último paso a VENCIDO. */
export function orderPublicLabel(estado: string, tipo: string, motivo?: string | null): string {
  return estado === "VENCIDO" ? expiredOrderLabel(tipo, motivo) : (ORDER_PUBLIC_LABELS[estado] ?? estado);
}

export const PAYMENT_PUBLIC_LABELS: Record<string, string> = {
  APROBADO: "Pago registrado",
  RECHAZADO: "Pago no aprobado",
  ERROR: "No se pudo procesar el pago",
};

export const COUPON_PUBLIC_LABELS: Record<string, string> = { ACTIVO: "Disponible", USADO: "Usado", VENCIDO: "Vencido", ANULADO: "Anulado" };

export const DESIGN_PUBLIC_LABELS: Record<string, string> = {
  SIN_PROPUESTA: "Estamos preparando tu diseño",
  PENDIENTE_APROBACION: "Esperando tu aprobación",
  CAMBIOS_SOLICITADOS: "Estamos realizando los cambios que pediste",
  APROBADO: "Diseño aprobado",
};
