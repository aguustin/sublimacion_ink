import { describe, expect, it } from "vitest";
import { isWeekend, subtractCountedHours } from "@/server/shared/business-hours";
import { cancellationWindowStart, recalculatedWindowStart } from "./order.policy";

const TZ = "America/Argentina/Buenos_Aires";
// Hora de Argentina (UTC−3): "2026-11-02T10:00-03:00" es el lunes 2 a las 10:00.
const at = (local: string) => new Date(`${local}:00-03:00`);

describe("ventana de 48 h (RN-30)", () => {
  it("cuenta los fines de semana: despacho el lunes 10:00, la ventana empieza el sábado 10:00 (T-130)", () => {
    const start = cancellationWindowStart(at("2026-11-02T10:00"), new Set(), TZ);
    expect(start).toEqual(at("2026-10-31T10:00"));
    // El sábado 12:00 (46 h antes) ya está dentro.
    expect(at("2026-10-31T12:00") >= start).toBe(true);
  });

  it("un domingo excluido corre el inicio al viernes 10:00 (T-131)", () => {
    expect(cancellationWindowStart(at("2026-11-02T10:00"), new Set(["2026-11-01"]), TZ)).toEqual(at("2026-10-30T10:00"));
  });

  it("una fecha excluida fuera de la ventana no la cambia", () => {
    expect(cancellationWindowStart(at("2026-11-02T10:00"), new Set(["2026-11-10"]), TZ)).toEqual(at("2026-10-31T10:00"));
  });

  it("con un criterio que excluye los fines de semana, el cálculo hacia atrás los salta (T-136)", () => {
    // Lunes 10:00 − 48 h de días hábiles: lunes 10 h, viernes 24 h, jueves 14 h → jueves 10:00.
    expect(subtractCountedHours(at("2026-11-02T10:00"), 48, isWeekend, TZ)).toEqual(at("2026-10-29T10:00"));
    // Desde la medianoche exacta, el tramo anterior es del día previo.
    expect(subtractCountedHours(at("2026-11-03T00:00"), 24, isWeekend, TZ)).toEqual(at("2026-11-02T00:00"));
  });
});

describe("recálculo sin cargos retroactivos (RN-30, T-133)", () => {
  const now = at("2026-11-02T12:00");

  it("si el inicio nuevo quedaría en el pasado, empieza en el momento del aviso", () => {
    expect(recalculatedWindowStart(at("2026-11-02T14:00"), at("2026-11-01T14:00"), now)).toEqual(now);
  });

  it("una ventana que ya empezó y seguiría empezada no cambia", () => {
    expect(recalculatedWindowStart(at("2026-11-02T08:00"), at("2026-11-01T08:00"), now)).toBeNull();
  });

  it("en el futuro se mueve al inicio calculado, y sin diferencia no hay cambio", () => {
    expect(recalculatedWindowStart(at("2026-11-04T10:00"), at("2026-11-03T10:00"), now)).toEqual(at("2026-11-03T10:00"));
    expect(recalculatedWindowStart(at("2026-11-04T10:00"), at("2026-11-04T10:00"), now)).toBeNull();
  });

  it("quitar una exclusión puede cerrar una ventana ya abierta, a favor del cliente", () => {
    expect(recalculatedWindowStart(at("2026-11-02T08:00"), at("2026-11-03T08:00"), now)).toEqual(at("2026-11-03T08:00"));
  });
});
