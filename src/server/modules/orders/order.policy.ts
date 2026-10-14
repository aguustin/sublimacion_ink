// Parámetros comerciales acordados que usa el ciclo del pedido, en un solo lugar.

/** RN-22: un pago online iniciado retiene el stock 30 minutos. */
export const ONLINE_PAYMENT_HOLD_MINUTES = 30;

/** RN-15: porcentaje del cargo por cancelación; se guarda en el pedido al confirmarlo. */
export const CANCELLATION_CHARGE_PERCENT = 15;

export function onlinePaymentExpiry(from: Date): Date {
  return new Date(from.getTime() + ONLINE_PAYMENT_HOLD_MINUTES * 60 * 1000);
}

/**
 * RN-06: la reserva en efectivo vence a las 24 h. Por ahora son 24 h corridas: INC-06.2
 * reemplaza este cálculo por horas hábiles sin fines de semana ni feriados (RN-29).
 */
export function cashReservationExpiry(from: Date): Date {
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}
