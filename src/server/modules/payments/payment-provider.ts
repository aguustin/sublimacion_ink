import { randomUUID } from "node:crypto";

// Puerto de pagos (RF-46). En la v1 la única implementación es la simulada: no mueve dinero (RN-09).
// Una pasarela real (RF-F03) implementaría la misma interfaz.

export type ChargeResult = "APROBADO" | "RECHAZADO" | "ERROR";

export type ChargeRequest = {
  pedidoId: string;
  importeCentavos: number;
  /** Solo en la simulación: el resultado que se quiere probar (RF-48). */
  resultadoForzado: ChargeResult;
};

export type PaymentProvider = {
  name: string;
  simulated: boolean;
  charge(request: ChargeRequest): Promise<{ estado: ChargeResult; referencia: string }>;
};

export const simulatedPaymentProvider: PaymentProvider = {
  name: "SIMULADO",
  simulated: true,
  async charge({ resultadoForzado }) {
    return { estado: resultadoForzado, referencia: `SIM-${randomUUID()}` };
  },
};
