import { subtractCountedHours } from "@/server/shared/business-hours";

// Parámetros comerciales acordados que usa el ciclo del pedido, en un solo lugar.

/** RN-22: un pago online iniciado retiene el stock 30 minutos. */
export const ONLINE_PAYMENT_HOLD_MINUTES = 30;

/** RN-15: porcentaje del cargo por cancelación; se guarda en el pedido al confirmarlo. */
export const CANCELLATION_CHARGE_PERCENT = 15;

/** RN-03, RN-30: la ventana de cancelación con cargo son las 48 h previas a la fecha comprometida. */
export const CANCELLATION_WINDOW_HOURS = 48;

export function onlinePaymentExpiry(from: Date): Date {
  return new Date(from.getTime() + ONLINE_PAYMENT_HOLD_MINUTES * 60 * 1000);
}

// El vencimiento de la reserva en efectivo (24 h hábiles, RN-29) está en reservation.policy.ts.

/**
 * RN-30: inicio de la ventana = fecha comprometida − 48 h que cuentan. Cuentan los fines de semana y
 * los feriados; no cuentan los días completos que el admin excluye. Excluir también los fines de
 * semana sería cambiar `isExcluded`, sin tocar el resto (D-43).
 */
export function cancellationWindowStart(
  dispatchDate: Date,
  excludedDays: ReadonlySet<string> = new Set(),
  timeZone = "America/Argentina/Buenos_Aires",
): Date {
  return subtractCountedHours(dispatchDate, CANCELLATION_WINDOW_HOURS, (date) => excludedDays.has(date), timeZone);
}

/**
 * RN-30 (T-133, confirmado en v1.32): un recálculo por fechas excluidas nunca deja el inicio antes
 * del momento del aviso, así que un cambio de la tienda no genera cargos retroactivos. Una ventana
 * que ya empezó y seguiría empezada no cambia. Devuelve `null` si el inicio no cambia.
 */
export function recalculatedWindowStart(current: Date, computed: Date, now: Date): Date | null {
  if (current <= now && computed <= now) return null;
  const next = computed < now ? now : computed;
  return next.getTime() === current.getTime() ? null : next;
}

/** D-46: la tienda tiene 48 h corridas para cotizar el envío, y el cliente otras 48 h para responder. */
export const SHIPPING_QUOTE_STEP_HOURS = 48;

export function shippingQuoteStepExpiry(from: Date): Date {
  return new Date(from.getTime() + SHIPPING_QUOTE_STEP_HOURS * 60 * 60 * 1000);
}

/** RN-21: seña de los personalizados, sobre los productos después del cupón y sin el envío (D-40, D-48). */
export const DEPOSIT_PERCENT = 20;

export function depositAmount(productosCobradosCentavos: number): number {
  return Math.round((productosCobradosCentavos * DEPOSIT_PERCENT) / 100);
}
