import { addCountedHours, isWeekend } from "@/server/shared/business-hours";

/** RN-06: horas que tiene el cliente para pagar en efectivo una reserva. */
export const CASH_RESERVATION_HOURS = 24;

/**
 * RN-29: vencimiento de una reserva en efectivo. Se suman 24 h de días hábiles en la zona horaria
 * de la tienda: los sábados, domingos y feriados no cuentan. [PROPUESTA] Se cuentan las horas
 * completas de cada día hábil, no el horario de atención; cambiar ese criterio es cambiar esta función.
 */
export function reservationExpiry(start: Date, holidays: ReadonlySet<string>, timeZone: string): Date {
  return addCountedHours(start, CASH_RESERVATION_HOURS, (date) => isWeekend(date) || holidays.has(date), timeZone);
}
