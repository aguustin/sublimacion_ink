import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CancellationBreakdown } from "@/app/cancellation-breakdown";
import { CustomOrderDetails } from "@/app/custom-order-details";
import { DESIGN_STATUS_LABELS, DesignHistory } from "@/app/design-history";
import { requirePageUser } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, paymentWindowOpen } from "@/lib/orders";
import { getOrderDesigns } from "@/server/modules/designs/design.service";
import { getCustomOrderDetails } from "@/server/modules/orders/custom-order.service";
import { getCustomerOrder } from "@/server/modules/orders/orders.service";
import { getShippingQuoteView } from "@/server/modules/orders/shipping-quote.service";
import { getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import { getConfig } from "@/server/shared/config";
import { AppError } from "@/server/shared/errors";
import { CancelOrder } from "./cancel-order";
import { DesignReview } from "./design-review";
import { QuoteResponse } from "./quote-response";
import { ShippingResponse } from "./shipping-response";
import { SimulatedPayment } from "./simulated-payment";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pedido · Sublimaciones", robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const order = await getCustomerOrder(user.id, (await params).id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const open = paymentWindowOpen(order);
  // RN-23: en estos estados el cliente cancela comunicándose con la tienda.
  const contactToCancel = ["LISTO_PARA_RETIRO", "DESPACHADO"].includes(order.estado);
  const contact = order.estado === "RESERVADO" || contactToCancel ? await getStoreContact() : null;
  const cancellable = !["ENVIO_COTIZADO", "LISTO_PARA_RETIRO", "DESPACHADO", "ENTREGADO", "CANCELADO", "VENCIDO"].includes(order.estado);
  const custom = order.tipo === "PERSONALIZADO" ? await getCustomOrderDetails(order.id) : null;
  const designs = custom ? await getOrderDesigns(order.id) : [];
  const designOpen = ["PENDIENTE_PAGO", "RESERVADO", "CONFIRMADO", "EN_PRODUCCION"].includes(order.estado);
  const pendingQuote = custom?.cotizaciones.some((entry) => entry.estado === "PROPUESTA") ?? false;
  // RN-21: saldo de un personalizado confirmado; online antes del despacho (con envío) o hasta el retiro.
  const paid = order.pagos.filter((payment) => payment.estado === "APROBADO").reduce((sum, payment) => sum + payment.importeCentavos, 0);
  const balance = custom ? Math.max(0, order.totalCentavos - paid) : 0;
  const balanceStates = order.modalidadEntrega === "ENVIO" ? ["CONFIRMADO", "EN_PRODUCCION"] : ["CONFIRMADO", "EN_PRODUCCION", "LISTO_PARA_RETIRO"];
  const balancePayable = balance > 0 && balanceStates.includes(order.estado);
  const quote = order.estado === "ENVIO_COTIZADO" && order.venceEn! > new Date() ? await getShippingQuoteView(user.id, order.id) : null;
  const address = order.direccionEnvio as { calle: string; ciudad: string; provincia: string; codigoPostal: string } | null;
  const windowStarted = order.inicioVentanaCargo !== null && (order.ventanaCargoFija || order.inicioVentanaCargo <= new Date());

  return (
    <main>
      <h1>Pedido #{order.numero}</h1>
      <p>
        Estado: <strong>{ORDER_STATUS_LABELS[order.estado]}</strong> ·{" "}
        {order.modalidadEntrega === "ENVIO" ? "Envío a domicilio" : "Retiro en el local"}
      </p>
      {order.modalidadEntrega === "ENVIO" && address && (
        <p>
          Dirección: {address.calle}, {address.ciudad}, {address.provincia} ({address.codigoPostal})
        </p>
      )}

      {order.estado === "ENVIO_A_COTIZAR" && <p>La tienda te envía el costo del envío antes del {formatDateTime(order.venceEn!)}.</p>}
      {order.estado === "ENVIO_COTIZADO" &&
        (quote?.cotizacion ? (
          <>
            <p>Respondé antes del {formatDateTime(order.venceEn!)}; después el pedido se cancela.</p>
            <ShippingResponse
              orderId={order.id}
              cotizacionId={quote.cotizacion.id}
              costoEnvioCentavos={quote.costoEnvioCentavos}
              nota={quote.cotizacion.nota}
              subtotalProductosCentavos={quote.subtotalProductosCentavos}
              descuentoCuponCentavos={quote.descuentoCuponCentavos}
              hayStock={quote.hayStock}
              hasPhone={user.telefono !== null}
            />
          </>
        ) : (
          <p>El plazo para responder la cotización del envío venció.</p>
        ))}

      {custom && <CustomOrderDetails details={custom} orderHref={(id) => `/pedidos/${id}`} />}
      {designs.map((item) => {
        const design = item.diseno;
        const current = design?.versiones.find((version) => version.id === design.versionVigenteId);
        return (
          <section key={item.id} aria-label="Diseño">
            <h2>Diseño: {item.descripcion}</h2>
            <p>{DESIGN_STATUS_LABELS[design?.estado ?? "SIN_PROPUESTA"]}</p>
            {design && <DesignHistory design={design} />}
            {designOpen && current && !current.aprobacion && design?.estado === "PENDIENTE_APROBACION" && (
              <DesignReview versionId={current.id} numero={current.numero} huella={current.huella} />
            )}
          </section>
        );
      })}
      {order.estado === "EN_DEFINICION" &&
        (pendingQuote ? (
          <QuoteResponse orderId={order.id} shipping={order.modalidadEntrega === "ENVIO"} hasPhone={user.telefono !== null} />
        ) : (
          <p>La tienda está preparando la cotización. Te avisamos cuando esté lista.</p>
        ))}
      {custom && order.senaCentavos !== null && (order.estado === "PENDIENTE_PAGO" || order.estado === "RESERVADO") && (
        <p>
          Seña a pagar: <strong>{formatPesos(order.senaCentavos)}</strong> (20 % de los productos). El resto se paga como saldo.
        </p>
      )}
      {balancePayable && (
        <>
          <p>
            Saldo pendiente: <strong>{formatPesos(balance)}</strong>
            {order.modalidadEntrega === "ENVIO"
              ? " (incluye el envío); se paga antes del despacho."
              : "; podés pagarlo online o en efectivo al retirar."}
          </p>
          {getConfig().PAYMENTS_MODE === "simulado" && <SimulatedPayment orderId={order.id} />}
        </>
      )}
      {order.estado === "PENDIENTE_PAGO" &&
        (open ? (
          <>
            <p>Completá el pago antes del {formatDateTime(order.venceEn!)}.</p>
            {getConfig().PAYMENTS_MODE === "simulado" && <SimulatedPayment orderId={order.id} />}
          </>
        ) : (
          <p>El plazo para pagar venció.</p>
        ))}
      {order.estado === "RESERVADO" &&
        (open ? (
          <>
            <p>Pagá en efectivo en el local antes del {formatDateTime(order.venceEn!)}. Después la reserva vence.</p>
            {contact && (contact.emailContacto || contact.telefonoContacto) && (
              <p>Contacto de la tienda: {[contact.emailContacto, contact.telefonoContacto].filter(Boolean).join(" · ")}</p>
            )}
          </>
        ) : (
          <p>El plazo de la reserva venció.</p>
        ))}

      {order.fechaDespachoComprometida && (
        <p>
          Va a estar listo para retirar el {formatDateTime(order.fechaDespachoComprometida)}.{" "}
          {windowStarted
            ? "Si lo cancelás ahora, se cobra un cargo por servicio."
            : `Si lo cancelás a partir del ${formatDateTime(order.inicioVentanaCargo!)}, se cobra un cargo por servicio.`}
        </p>
      )}

      {order.cancelacion && (
        <>
          <h2>Cancelación</h2>
          <p>
            {order.cancelacion.rol === "TIENDA" ? "Cancelado por la tienda" : "Cancelado por vos"} el {formatDateTime(order.cancelacion.creadoEn)}:{" "}
            {order.cancelacion.motivo}
          </p>
          <CancellationBreakdown breakdown={order.cancelacion} />
        </>
      )}
      {cancellable && <CancelOrder orderId={order.id} />}
      {contactToCancel && contact && (
        <p>
          Para cancelar este pedido comunicate con la tienda:{" "}
          {[contact.emailContacto, contact.telefonoContacto].filter(Boolean).join(" · ") || "datos de contacto no cargados"}.
        </p>
      )}

      <h2>Productos</h2>
      <ul>
        {order.items.map((item) => (
          <li key={item.id}>
            {item.descripcion} × {item.cantidad} = {formatPesos(item.precioUnitarioCentavos * item.cantidad)}
          </li>
        ))}
      </ul>
      {order.descuentoCuponCentavos > 0 && <p>Cupón: −{formatPesos(order.descuentoCuponCentavos)}</p>}
      {order.costoEnvioCentavos > 0 && <p>Envío: {formatPesos(order.costoEnvioCentavos)}</p>}
      <p>
        Total: <strong>{formatPesos(order.totalCentavos)}</strong>
      </p>

      {order.pagos.length > 0 && (
        <>
          <h2>Pagos</h2>
          <ul>
            {order.pagos.map((payment) => (
              <li key={payment.id}>
                {formatDateTime(payment.creadoEn)} · {payment.medio === "ONLINE" ? "Online" : "Efectivo"}
                {payment.simulado && " (SIMULADO)"} · {PAYMENT_STATUS_LABELS[payment.estado]} · {formatPesos(payment.importeCentavos)}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Historial</h2>
      <ul>
        {order.historial.map((entry) => (
          <li key={entry.id}>
            {formatDateTime(entry.creadoEn)} · {ORDER_STATUS_LABELS[entry.estadoNuevo]}
          </li>
        ))}
      </ul>
    </main>
  );
}
