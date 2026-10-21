import { formatPesos } from "@/lib/money";

type Breakdown = {
  regla: string;
  dentroVentana: boolean;
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
};

const RULE_LABELS: Record<string, string> = {
  RN_19: "Cancelación por la tienda: sin cargo y devolución total",
  RN_21: "Dentro de las 48 h previas: se retiene la seña",
  RN_15: "Dentro de las 48 h previas: cargo por servicio",
  SIN_CARGO: "Sin cargo",
};

/** Desglose de una cancelación (RF-55), igual para la vista previa, el cliente y el admin. */
export function CancellationBreakdown({ breakdown }: { breakdown: Breakdown }) {
  const b = breakdown;
  return (
    <dl>
      <dt>Regla</dt>
      <dd>{RULE_LABELS[b.regla] ?? b.regla}</dd>
      <dt>Productos</dt>
      <dd>{formatPesos(b.subtotalProductosCentavos)}</dd>
      {b.descuentoCuponCentavos > 0 && (
        <>
          <dt>Descuento del cupón</dt>
          <dd>−{formatPesos(b.descuentoCuponCentavos)}</dd>
          <dt>Productos cobrados</dt>
          <dd>{formatPesos(b.productosCobradosCentavos)}</dd>
        </>
      )}
      {b.envioCentavos > 0 && (
        <>
          <dt>Envío</dt>
          <dd>{formatPesos(b.envioCentavos)}</dd>
        </>
      )}
      {b.senaPagadaCentavos > 0 && (
        <>
          <dt>Seña pagada</dt>
          <dd>{formatPesos(b.senaPagadaCentavos)}</dd>
          <dt>Saldo pagado</dt>
          <dd>{formatPesos(b.saldoPagadoCentavos)}</dd>
        </>
      )}
      <dt>Total pagado</dt>
      <dd>{formatPesos(b.totalPagadoCentavos)}</dd>
      <dt>Cargo{b.porcentajeAplicado !== null && ` (${b.porcentajeAplicado} % de los productos, sin envío)`}</dt>
      <dd>{formatPesos(b.cargoCentavos)}</dd>
      <dt>A devolver</dt>
      <dd>{formatPesos(b.aReembolsarCentavos)}</dd>
    </dl>
  );
}
