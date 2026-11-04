import type { MovimientoStock } from "@/generated/prisma/client";

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

const TYPE_LABELS: Record<MovimientoStock["tipo"], string> = {
  INGRESO: "Ingreso",
  AJUSTE: "Ajuste",
  RETENCION: "Retención (pedido)",
  LIBERACION: "Liberación (pedido)",
  CONSUMO: "Consumo (pedido)",
};

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export function MovementsTable({ movements }: { movements: MovimientoStock[] }) {
  if (movements.length === 0) return <p>Todavía no hay movimientos.</p>;
  return (
    <table className="ink-table-cards">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Tipo</th>
          <th>Físico</th>
          <th>Reservado</th>
          <th>Motivo</th>
        </tr>
      </thead>
      <tbody>
        {movements.map((movement) => (
          <tr key={movement.id}>
            <td>{dateFormat.format(movement.creadoEn)}</td>
            <td data-label="Tipo">{TYPE_LABELS[movement.tipo]}</td>
            <td data-label="Físico">{signed(movement.deltaFisico)}</td>
            <td data-label="Reservado">{signed(movement.deltaReservado)}</td>
            <td data-label="Motivo">{movement.motivo}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
