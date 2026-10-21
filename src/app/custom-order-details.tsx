import Link from "next/link";
import { formatPesos } from "@/lib/money";
import { formatDateTime } from "@/lib/orders";
import type { getCustomOrderDetails } from "@/server/modules/orders/custom-order.service";
import { OpenFileButton } from "./open-file-button";

type Details = NonNullable<Awaited<ReturnType<typeof getCustomOrderDetails>>>;

const QUOTE_LABELS: Record<string, string> = { PROPUESTA: "vigente", ACEPTADA: "aceptada", RECHAZADA: "rechazada", REEMPLAZADA: "reemplazada" };

// Fechas sin hora (fecha deseada y de entrega): se muestran tal como se cargaron.
const dateOnly = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" });

/** Solicitud, referencias y cotizaciones de un personalizado (F-03), igual para el cliente y el admin. */
export function CustomOrderDetails({ details, orderHref }: { details: Details; orderHref: (id: string) => string }) {
  const { solicitud, referencias, cotizaciones } = details;
  const variant = solicitud?.variante;
  return (
    <>
      {details.pedidoOrigen && (
        <p>
          Reemisión del <Link href={orderHref(details.pedidoOrigen.id)}>pedido #{details.pedidoOrigen.numero}</Link>, que venció sin seña.
        </p>
      )}
      {details.reemision && (
        <p>
          Se reemitió en el <Link href={orderHref(details.reemision.id)}>pedido #{details.reemision.numero}</Link>.
        </p>
      )}
      {solicitud && variant && (
        <>
          <h2>Solicitud</h2>
          <p>
            {variant.producto.nombre} · {[variant.material, variant.medida, variant.color, variant.talle].filter(Boolean).join(" · ") || "Única"} ×{" "}
            {solicitud.cantidad} · para el {dateOnly.format(solicitud.fechaDeseada)}
          </p>
          <p>{solicitud.descripcion}</p>
        </>
      )}
      {referencias.length > 0 && (
        <>
          <h3>Referencias</h3>
          <ul>
            {referencias.map(({ archivo }) => (
              <li key={archivo.id}>
                <OpenFileButton fileId={archivo.id} name={archivo.nombreOriginal} />
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>Cotizaciones</h2>
      {cotizaciones.length === 0 ? (
        <p>Todavía no hay cotización.</p>
      ) : (
        <ul>
          {cotizaciones.map((quote) => (
            <li key={quote.id}>
              {formatDateTime(quote.creadoEn)} · {formatPesos(quote.precioUnitarioCentavos)} por unidad = {formatPesos(quote.precioProductosCentavos)}
              {quote.costoEnvioCentavos !== null && ` + envío ${formatPesos(quote.costoEnvioCentavos)}`} · entrega estimada{" "}
              {dateOnly.format(quote.fechaEntregaPropuesta)} · {quote.detalle} · {QUOTE_LABELS[quote.estado]}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
