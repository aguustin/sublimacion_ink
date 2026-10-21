import { describe, expect, it } from "vitest";
import { evaluateCancellation, estimatedRealCost, type CancellationInput } from "./cancellation.policy";

const now = new Date("2026-10-20T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

/** Pedido estándar confirmado, pagado online, con fecha comprometida dentro de 49 h. */
const confirmed = (overrides: Partial<CancellationInput> = {}): CancellationInput => ({
  rol: "CLIENTE",
  estado: "CONFIRMADO",
  tipo: "ESTANDAR",
  subtotalProductosCentavos: 300000,
  descuentoCuponCentavos: 0,
  envioCentavos: 20000,
  porcentajeCargo: 15,
  inicioVentanaCargo: hours(1),
  ventanaCargoFija: false,
  pagos: [{ concepto: "TOTAL", importeCentavos: 320000 }],
  now,
  ...overrides,
});

describe("evaluateCancellation (RN-24)", () => {
  it("dentro de la ventana: 15 % de los productos, sin envío; se reembolsa el resto (T-31)", () => {
    const decision = evaluateCancellation(confirmed({ inicioVentanaCargo: hours(-1) }));
    expect(decision).toMatchObject({
      permitida: true,
      regla: "RN_15",
      dentroVentana: true,
      desglose: { productosCobradosCentavos: 300000, porcentajeAplicado: 15, cargoCentavos: 45000, aReembolsarCentavos: 275000, incluyeEnvio: true },
    });
  });

  it("fuera de la ventana o sin fecha confirmada: sin cargo y reembolso total (T-32, T-35, T-72)", () => {
    expect(evaluateCancellation(confirmed())).toMatchObject({
      regla: "SIN_CARGO",
      dentroVentana: false,
      desglose: { cargoCentavos: 0, aReembolsarCentavos: 320000 },
    });
    expect(evaluateCancellation(confirmed({ inicioVentanaCargo: null }))).toMatchObject({ regla: "SIN_CARGO" });
  });

  it("con la marca fija de RN-14, cuenta como dentro aunque la fecha se haya pospuesto (T-70)", () => {
    expect(evaluateCancellation(confirmed({ inicioVentanaCargo: hours(100), ventanaCargoFija: true }))).toMatchObject({
      regla: "RN_15",
      dentroVentana: true,
    });
  });

  it("redondea el cargo al centavo con fracciones (T-73)", () => {
    const decision = evaluateCancellation(
      confirmed({ subtotalProductosCentavos: 33333, inicioVentanaCargo: hours(-1), pagos: [{ concepto: "TOTAL", importeCentavos: 53333 }] }),
    );
    expect(decision).toMatchObject({ desglose: { cargoCentavos: 5000, aReembolsarCentavos: 48333 } }); // 4999,95 → 5000
  });

  it("usa el porcentaje guardado en el pedido, no la constante vigente (T-96)", () => {
    expect(evaluateCancellation(confirmed({ porcentajeCargo: 10, inicioVentanaCargo: hours(-1) }))).toMatchObject({
      desglose: { cargoCentavos: 30000 },
    });
  });

  it("con cupón, la base es el importe de productos cobrado (D-36, T-98)", () => {
    const decision = evaluateCancellation(
      confirmed({ descuentoCuponCentavos: 100000, inicioVentanaCargo: hours(-1), pagos: [{ concepto: "TOTAL", importeCentavos: 220000 }] }),
    );
    expect(decision).toMatchObject({ desglose: { productosCobradosCentavos: 200000, cargoCentavos: 30000, aReembolsarCentavos: 190000 } });
  });

  it("personalizado con seña dentro de la ventana: retiene la seña completa y nunca el 15 % (RN-21, T-74, T-99)", () => {
    const decision = evaluateCancellation(
      confirmed({
        tipo: "PERSONALIZADO",
        inicioVentanaCargo: hours(-1),
        pagos: [
          { concepto: "SENA", importeCentavos: 60000 },
          { concepto: "SALDO", importeCentavos: 260000 },
        ],
      }),
    );
    expect(decision).toMatchObject({
      regla: "RN_21",
      desglose: {
        senaPagadaCentavos: 60000,
        saldoPagadoCentavos: 260000,
        porcentajeAplicado: null,
        cargoCentavos: 60000,
        aReembolsarCentavos: 260000,
      },
    });
  });

  it("personalizado con seña fuera de la ventana: devuelve todo (RN-21, T-111)", () => {
    const decision = evaluateCancellation(confirmed({ tipo: "PERSONALIZADO", pagos: [{ concepto: "SENA", importeCentavos: 60000 }] }));
    expect(decision).toMatchObject({ regla: "SIN_CARGO", desglose: { cargoCentavos: 0, aReembolsarCentavos: 60000 } });
  });

  it("la tienda cancela: RN-19 prevalece sobre todo, sin cargo y con envío, aun dentro de la ventana (T-76)", () => {
    const decision = evaluateCancellation(confirmed({ rol: "TIENDA", inicioVentanaCargo: hours(-1), estado: "LISTO_PARA_RETIRO" }));
    expect(decision).toMatchObject({
      regla: "RN_19",
      dentroVentana: false,
      desglose: { cargoCentavos: 0, aReembolsarCentavos: 320000, incluyeEnvio: true },
    });
  });

  it("antes del pago no hay cargo (RN-23)", () => {
    for (const estado of ["PENDIENTE_PAGO", "RESERVADO", "ENVIO_A_COTIZAR"] as const) {
      expect(evaluateCancellation(confirmed({ estado, pagos: [], inicioVentanaCargo: hours(-1) }))).toMatchObject({
        regla: "SIN_CARGO",
        desglose: { cargoCentavos: 0, aReembolsarCentavos: 0, incluyeEnvio: false },
      });
    }
  });

  it("el cliente no cancela listo para retirar, despachado ni entregado; sí en producción (RN-23, T-95)", () => {
    for (const estado of ["LISTO_PARA_RETIRO", "DESPACHADO", "ENTREGADO"] as const) {
      expect(evaluateCancellation(confirmed({ estado }))).toMatchObject({ permitida: false });
    }
    expect(evaluateCancellation(confirmed({ estado: "LISTO_PARA_RETIRO" }))).toMatchObject({ codigo: "CANCELACION_NO_PERMITIDA" });
    expect(evaluateCancellation(confirmed({ estado: "EN_PRODUCCION" }))).toMatchObject({ permitida: true });
  });

  it("estados finales: nadie cancela", () => {
    for (const estado of ["CANCELADO", "VENCIDO", "ENTREGADO", "DESPACHADO"] as const) {
      expect(evaluateCancellation(confirmed({ estado, rol: "TIENDA" }))).toMatchObject({ permitida: false, codigo: "ESTADO_INVALIDO" });
    }
  });
});

describe("estimatedRealCost (RF-53)", () => {
  it("es el 20 % de los productos cobrados, redondeado", () => {
    expect(estimatedRealCost(300000)).toBe(60000);
    expect(estimatedRealCost(33333)).toBe(6667);
  });
});
