import { describe, expect, it } from "vitest";
import { addCountedHours } from "@/server/shared/business-hours";
import { onlinePaymentExpiry } from "./order.policy";
import { reservationExpiry } from "./reservation.policy";

const TZ = "America/Argentina/Buenos_Aires"; // UTC−3, sin horario de verano
/** Hora local de Argentina (octubre de 2026: el 16 es viernes). */
const ar = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 9, day, hour + 3, minute));
const none = new Set<string>();

describe("vencimiento de la reserva en 24 h hábiles (RN-29)", () => {
  it("un día hábil completo sin fin de semana: jueves 10:00 → viernes 10:00", () => {
    expect(reservationExpiry(ar(15, 10), none, TZ)).toEqual(ar(16, 10));
  });

  it("viernes 18:00 → lunes 18:00 (T-125)", () => {
    expect(reservationExpiry(ar(16, 18), none, TZ)).toEqual(ar(19, 18));
  });

  it("sábado 10:00 → martes 00:00, y viernes 18:00 con el lunes feriado → martes 18:00 (T-126)", () => {
    expect(reservationExpiry(ar(17, 10), none, TZ)).toEqual(ar(20, 0));
    expect(reservationExpiry(ar(16, 18), new Set(["2026-10-19"]), TZ)).toEqual(ar(20, 18));
  });

  it("evalúa el cambio de día en hora local y devuelve el instante en UTC (T-128)", () => {
    // Viernes 23:30 en Argentina ya es sábado 02:30 en UTC: igual cuenta media hora del viernes.
    const expiry = reservationExpiry(ar(16, 23, 30), none, TZ);
    expect(expiry).toEqual(ar(19, 23, 30));
    expect(expiry.toISOString()).toBe("2026-10-20T02:30:00.000Z");
  });

  it("si empieza en un feriado, cuenta desde el día hábil siguiente", () => {
    expect(reservationExpiry(ar(21, 10), new Set(["2026-10-21"]), TZ)).toEqual(ar(23, 0));
  });

  it("no se cuelga si ningún día cuenta", () => {
    expect(() => addCountedHours(ar(15, 10), 24, () => true, TZ)).toThrow();
  });
});

describe("pago online (RN-22)", () => {
  it("vence a los 30 minutos corridos aunque sea sábado (T-129)", () => {
    expect(onlinePaymentExpiry(ar(17, 10))).toEqual(ar(17, 10, 30));
  });
});
