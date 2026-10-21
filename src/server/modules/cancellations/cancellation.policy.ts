import type { ConceptoPago, EstadoPedido, ReglaCancelacion, RolCancelacion, TipoPedido } from "@/generated/prisma/client";
import { canTransition } from "@/server/modules/orders/order-transitions";

// Política de cancelación (sección 8.4, 8.5): una sola función pura que decide si se puede
// cancelar, qué regla de cargo aplica según la precedencia de RN-24 y el desglose (RF-55).

/** RF-53, R-15: referencia interna del costo real; no es un cargo. */
export const ESTIMATED_REAL_COST_PERCENT = 20;

/** RN-23: en estos estados el cliente no cancela desde la web; se comunica con la tienda. */
const CLIENT_MUST_CONTACT_STORE: readonly EstadoPedido[] = ["LISTO_PARA_RETIRO", "DESPACHADO", "ENTREGADO"];

/** RN-23: solo en estos estados la ventana de 48 h genera cargo; antes del pago nunca hay cargo. */
const CHARGEABLE_STATES: readonly EstadoPedido[] = ["CONFIRMADO", "EN_PRODUCCION"];

export type CancellationInput = {
  rol: RolCancelacion;
  estado: EstadoPedido;
  tipo: TipoPedido;
  subtotalProductosCentavos: number;
  /** Descuento del cupón usado (INC-11); 0 mientras no haya cupones. */
  descuentoCuponCentavos: number;
  envioCentavos: number;
  /** Porcentaje del cargo guardado al confirmar (RN-15). */
  porcentajeCargo: number | null;
  inicioVentanaCargo: Date | null;
  ventanaCargoFija: boolean;
  /** Pagos aprobados del pedido. */
  pagos: readonly { concepto: ConceptoPago; importeCentavos: number }[];
  now: Date;
};

export type CancellationBreakdown = {
  subtotalProductosCentavos: number;
  descuentoCuponCentavos: number;
  productosCobradosCentavos: number;
  envioCentavos: number;
  senaPagadaCentavos: number;
  saldoPagadoCentavos: number;
  totalPagadoCentavos: number;
  porcentajeAplicado: number | null;
  cargoCentavos: number;
  aReembolsarCentavos: number;
  incluyeEnvio: boolean;
};

export type CancellationDecision =
  | { permitida: false; codigo: "CANCELACION_NO_PERMITIDA" | "ESTADO_INVALIDO"; mensaje: string }
  | { permitida: true; regla: ReglaCancelacion; dentroVentana: boolean; desglose: CancellationBreakdown };

const sum = (pagos: CancellationInput["pagos"], concepto?: ConceptoPago) =>
  pagos.filter((pago) => !concepto || pago.concepto === concepto).reduce((total, pago) => total + pago.importeCentavos, 0);

/** RN-03, RN-14, RN-30: dentro de la ventana si ya empezó o si la fecha se confirmó con 48 h o menos. */
export function isInsideWindow({
  inicioVentanaCargo,
  ventanaCargoFija,
  now,
}: Pick<CancellationInput, "inicioVentanaCargo" | "ventanaCargoFija" | "now">) {
  return inicioVentanaCargo !== null && (ventanaCargoFija || inicioVentanaCargo <= now);
}

export function evaluateCancellation(input: CancellationInput): CancellationDecision {
  if (!canTransition(input.estado, "CANCELADO")) {
    return { permitida: false, codigo: "ESTADO_INVALIDO", mensaje: "Este pedido ya no se puede cancelar." };
  }
  // (2) RN-23: el estado no permite que el cliente cancele.
  if (input.rol === "CLIENTE" && CLIENT_MUST_CONTACT_STORE.includes(input.estado)) {
    return {
      permitida: false,
      codigo: "CANCELACION_NO_PERMITIDA",
      mensaje: "Este pedido ya no se puede cancelar desde la web. Comunicate con la tienda.",
    };
  }

  const senaPagadaCentavos = sum(input.pagos, "SENA");
  const totalPagadoCentavos = sum(input.pagos);
  const productosCobradosCentavos = input.subtotalProductosCentavos - input.descuentoCuponCentavos;
  const dentroVentana = CHARGEABLE_STATES.includes(input.estado) && isInsideWindow(input);
  const base = {
    subtotalProductosCentavos: input.subtotalProductosCentavos,
    descuentoCuponCentavos: input.descuentoCuponCentavos,
    productosCobradosCentavos,
    envioCentavos: input.envioCentavos,
    senaPagadaCentavos,
    saldoPagadoCentavos: sum(input.pagos, "SALDO"),
    totalPagadoCentavos,
    // Lo pagado incluye el envío: se devuelve con lo demás.
    incluyeEnvio: input.envioCentavos > 0 && totalPagadoCentavos > 0,
  };
  const refundAll = (regla: ReglaCancelacion): CancellationDecision => ({
    permitida: true,
    regla,
    dentroVentana,
    desglose: { ...base, porcentajeAplicado: null, cargoCentavos: 0, aReembolsarCentavos: totalPagadoCentavos },
  });

  // (1) RN-19: cancela la tienda → sin cargo y devolución total, envío incluido.
  if (input.rol === "TIENDA") return refundAll("RN_19");
  if (!dentroVentana) return refundAll("SIN_CARGO");

  // (3) RN-21: personalizado con seña → se retiene la seña completa, nunca el 15 %.
  if (input.tipo === "PERSONALIZADO" && senaPagadaCentavos > 0) {
    return {
      permitida: true,
      regla: "RN_21",
      dentroVentana,
      desglose: {
        ...base,
        porcentajeAplicado: null,
        cargoCentavos: senaPagadaCentavos,
        aReembolsarCentavos: totalPagadoCentavos - senaPagadaCentavos,
      },
    };
  }

  // (4) RN-15: 15 % de los productos cobrados, sin envío, redondeado al centavo.
  if (input.porcentajeCargo === null) throw new Error("Pedido confirmado sin porcentaje de cargo guardado (RN-15).");
  const cargoCentavos = Math.round((productosCobradosCentavos * input.porcentajeCargo) / 100);
  return {
    permitida: true,
    regla: "RN_15",
    dentroVentana,
    desglose: {
      ...base,
      porcentajeAplicado: input.porcentajeCargo,
      cargoCentavos,
      aReembolsarCentavos: Math.max(0, totalPagadoCentavos - cargoCentavos),
    },
  };
}

/** RF-53: costo real estimado precargado, sobre el valor de los productos cobrados. */
export function estimatedRealCost(productosCobradosCentavos: number): number {
  return Math.round((productosCobradosCentavos * ESTIMATED_REAL_COST_PERCENT) / 100);
}
