import { formatPesos } from "@/lib/money";
import { OpenFileButton } from "./open-file-button";

type Receipt = {
  id: string;
  tipo: "FACTURA" | "NOTA_CREDITO";
  letra: string;
  puntoVenta: number;
  numero: number;
  fechaEmision: Date;
  importeCentavos: number;
  archivo: { id: string; nombreOriginal: string } | null;
};

const TYPE_LABELS = { FACTURA: "Factura", NOTA_CREDITO: "Nota de crédito" } as const;

// La fecha de emisión no tiene hora: se muestra tal como se cargó.
const dateOnly = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" });

/** Número con el formato habitual de los comprobantes: punto de venta de 5 dígitos y número de 8. */
export const receiptNumber = (receipt: Pick<Receipt, "puntoVenta" | "numero">) =>
  `${String(receipt.puntoVenta).padStart(5, "0")}-${String(receipt.numero).padStart(8, "0")}`;

/** Comprobantes externos del pedido (RN-26, RF-56), con el PDF si se cargó; igual para el cliente y el admin. */
export function ReceiptsList({ receipts }: { receipts: Receipt[] }) {
  return (
    <ul>
      {receipts.map((receipt) => (
        <li key={receipt.id}>
          {TYPE_LABELS[receipt.tipo]} {receipt.letra} {receiptNumber(receipt)} · {dateOnly.format(receipt.fechaEmision)} ·{" "}
          {formatPesos(receipt.importeCentavos)}
          {receipt.archivo && (
            <>
              {" "}
              <OpenFileButton fileId={receipt.archivo.id} name="Descargar PDF" />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
