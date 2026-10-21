// Plazos que saltan días completos (RN-29 hacia adelante, RN-30 hacia atrás), en la zona horaria de la tienda.

const HOUR_MS = 60 * 60 * 1000;

// Crear un formateador es costoso: se reutiliza uno por zona horaria.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function cached(cache: Map<string, Intl.DateTimeFormat>, timeZone: string, create: () => Intl.DateTimeFormat) {
  let formatter = cache.get(timeZone);
  if (!formatter) cache.set(timeZone, (formatter = create()));
  return formatter;
}

/** Fecha local "AAAA-MM-DD" de un instante en una zona horaria. */
export function localDate(instant: Date, timeZone: string): string {
  return cached(
    dateFormatters,
    timeZone,
    () => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }),
  ).format(instant);
}

/** Diferencia en ms entre la hora local de la zona y UTC en ese instante. */
function zoneOffset(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    cached(
      dateTimeFormatters,
      timeZone,
      () =>
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          hourCycle: "h23",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
    )
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante de las 00:00 locales del día de `instant` desplazado `days` días. */
function localMidnight(instant: Date, days: number, timeZone: string): Date {
  const [year, month, day] = localDate(instant, timeZone).split("-").map(Number);
  const guess = Date.UTC(year!, month! - 1, day! + days);
  const first = guess - zoneOffset(new Date(guess), timeZone);
  // Segunda pasada por si el cambio de día coincide con un cambio de horario.
  return new Date(guess - zoneOffset(new Date(first), timeZone));
}

/** Instante de las 00:00 locales del día siguiente al de `instant`. */
function nextLocalMidnight(instant: Date, timeZone: string): Date {
  return localMidnight(instant, 1, timeZone);
}

/** Sábado o domingo en la fecha local. */
export function isWeekend(date: string): boolean {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * Suma horas que caen en días que cuentan, saltando los días completos para los que
 * `isExcludedDay(fechaLocal)` es verdadero. Las horas de un día que cuenta se toman completas.
 */
export function addCountedHours(start: Date, hours: number, isExcludedDay: (date: string) => boolean, timeZone: string): Date {
  let remaining = hours * HOUR_MS;
  let cursor = start;
  // Tope de seguridad: un año sin días que cuenten es un error de calendario, no un plazo.
  for (let guard = 0; remaining > 0; guard++) {
    if (guard > 366) throw new Error("No hay días hábiles suficientes para calcular el plazo.");
    const dayEnd = nextLocalMidnight(cursor, timeZone);
    if (!isExcludedDay(localDate(cursor, timeZone))) {
      const chunk = Math.min(remaining, dayEnd.getTime() - cursor.getTime());
      remaining -= chunk;
      if (remaining === 0) return new Date(cursor.getTime() + chunk);
    }
    cursor = dayEnd;
  }
  return cursor;
}

/**
 * Lo mismo hacia atrás: resta horas que caen en días que cuentan, saltando los días completos
 * excluidos. Lo usa la ventana de 48 h antes de la fecha comprometida (RN-30).
 */
export function subtractCountedHours(end: Date, hours: number, isExcludedDay: (date: string) => boolean, timeZone: string): Date {
  let remaining = hours * HOUR_MS;
  let cursor = end;
  for (let guard = 0; remaining > 0; guard++) {
    if (guard > 366) throw new Error("No hay días que cuenten suficientes para calcular el plazo.");
    // El tramo que termina en `cursor` pertenece al día del instante anterior (a las 00:00, al día previo).
    const dayOf = new Date(cursor.getTime() - 1);
    const dayStart = localMidnight(dayOf, 0, timeZone);
    if (!isExcludedDay(localDate(dayOf, timeZone))) {
      const chunk = Math.min(remaining, cursor.getTime() - dayStart.getTime());
      remaining -= chunk;
      if (remaining === 0) return new Date(cursor.getTime() - chunk);
    }
    cursor = dayStart;
  }
  return cursor;
}
