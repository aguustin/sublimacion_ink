import { notFound } from "next/navigation";
import { CancellationBreakdown } from "@/app/cancellation-breakdown";
import { CustomOrderDetails } from "@/app/custom-order-details";
import { DESIGN_STATUS_LABELS, DesignHistory } from "@/app/design-history";
import { requireAdminPage } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, paymentWindowOpen } from "@/lib/orders";
import { getOrderDesigns } from "@/server/modules/designs/design.service";
import { getCustomOrderDetails } from "@/server/modules/orders/custom-order.service";
import { getAdminOrder } from "@/server/modules/orders/orders.service";
import { AppError } from "@/server/shared/errors";
import { AdjustmentActions, RefundActions, StoreCancelForm } from "./cancellation-actions";
import { CashPaymentButton } from "./cash-payment-button";
import { CustomQuoteForm } from "./custom-quote-form";
import { DesignVersionForm, StartProductionButton } from "./design-admin";
import { DispatchDateForm } from "./dispatch-date-form";
import { ExtendReservationForm, ReactivateReservation } from "./reservation-actions";
import { ShippingQuoteForm } from "./shipping-quote-form";

export const dynamic = "force-dynamic";

const QUOTE_STATUS_LABELS: Record<string, string> = {
  PROPUESTA: "esperando respuesta",
  ACEPTADA: "aceptada",
  RECHAZADA: "rechazada",
  REEMPLAZADA: "reemplazada",
};

const ADJUSTMENT_LABELS: Record<string, string> = {
  CARGO_SERVICIO_CANCELACION: "Cargo por cancelación",
  RETENCION_SENA: "Seña retenida",
  REGISTRADO: "descontado de lo pagado",
  PENDIENTE_ARREGLO: "pendiente de arreglo con el cliente",
  COBRADO: "cobrado",
  CONDONADO: "condonado",
  INCOBRABLE: "incobrable",
};

const REFUND_LABELS: Record<string, string> = {
  PENDIENTE: "pendiente de ejecutar",
  REALIZADO_SIMULADO: "realizado (SIMULADO)",
  PENDIENTE_ARREGLO: "en efectivo, pendiente de arreglo",
  DEVUELTO: "devuelto en efectivo",
};

const FINAL_STATES = ["CANCELADO", "VENCIDO", "DESPACHADO", "ENTREGADO"];

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const order = await getAdminOrder((await params).id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const custom = order.tipo === "PERSONALIZADO" ? await getCustomOrderDetails(order.id) : null;
  const designs = custom ? await getOrderDesigns(order.id) : [];
  const designOpen = ["PENDIENTE_PAGO", "RESERVADO", "CONFIRMADO", "EN_PRODUCCION"].includes(order.estado);
  // RN-07 (15.4): habilitado si cada ítem tiene aprobada su versión vigente.
  const designsApproved =
    designs.length > 0 &&
    designs.every((item) => item.diseno?.versiones.some((version) => version.id === item.diseno?.versionVigenteId && version.aprobacion));
  const paid = order.pagos.filter((payment) => payment.estado === "APROBADO").reduce((sum, payment) => sum + payment.importeCentavos, 0);
  const balance = Math.max(0, order.totalCentavos - paid);
  const address = order.direccionEnvio as {
    calle: string;
    ciudad: string;
    provincia: string;
    codigoPostal: string;
    referencias: string | null;
  } | null;
  const quoteOpen = (order.estado === "ENVIO_A_COTIZAR" || order.estado === "ENVIO_COTIZADO") && order.venceEn! > new Date();

  return (
    <main>
      <h1>Pedido #{order.numero}</h1>
      <p>
        Estado: <strong>{ORDER_STATUS_LABELS[order.estado]}</strong> · {order.modalidadCierre === "ONLINE" ? "Pago online" : "Pago en efectivo"} ·{" "}
        {order.modalidadEntrega === "ENVIO" ? "Envío a domicilio" : "Retiro en el local"}
      </p>
      <p>
        Cliente: {order.cliente.nombre} · {order.cliente.email}
        {order.cliente.telefono && ` · ${order.cliente.telefono}`}
      </p>
      {address && (
        <>
          <h2>Envío</h2>
          <p>
            Dirección: {address.calle}, {address.ciudad}, {address.provincia} ({address.codigoPostal})
            {address.referencias && ` · ${address.referencias}`}
          </p>
          {order.cotizacionesEnvio.length > 0 && (
            <ul>
              {order.cotizacionesEnvio.map((quote) => (
                <li key={quote.id}>
                  {formatDateTime(quote.creadoEn)} · {quote.importeCentavos === null ? "No se puede enviar" : formatPesos(quote.importeCentavos)}
                  {quote.nota && ` · ${quote.nota}`} · {QUOTE_STATUS_LABELS[quote.estado]}
                </li>
              ))}
            </ul>
          )}
          {quoteOpen && (
            <>
              <p>
                {order.estado === "ENVIO_A_COTIZAR" ? "Cotizá el envío" : "El cliente tiene que responder"} antes del {formatDateTime(order.venceEn!)}
                ; después el pedido se cancela.
              </p>
              <ShippingQuoteForm orderId={order.id} hasQuote={order.estado === "ENVIO_COTIZADO"} />
            </>
          )}
        </>
      )}
      {order.estado === "RESERVADO" &&
        (paymentWindowOpen(order) ? (
          <>
            <p>La reserva vence el {formatDateTime(order.venceEn!)}.</p>
            <CashPaymentButton orderId={order.id} total={formatPesos(custom ? (order.senaCentavos ?? 0) : order.totalCentavos)} />
            <h2>Extender la reserva</h2>
            <ExtendReservationForm orderId={order.id} />
          </>
        ) : (
          <p>La reserva venció: no se puede registrar el pago.</p>
        ))}
      {custom && <CustomOrderDetails details={custom} orderHref={(id) => `/admin/pedidos/${id}`} />}
      {designs.map((item) => (
        <section key={item.id} aria-label="Diseño">
          <h2>Diseño: {item.descripcion}</h2>
          <p>{DESIGN_STATUS_LABELS[item.diseno?.estado ?? "SIN_PROPUESTA"]}</p>
          {item.diseno && <DesignHistory design={item.diseno} />}
          {designOpen && <DesignVersionForm itemId={item.id} />}
        </section>
      ))}
      {custom && order.estado === "EN_PRODUCCION" && !designsApproved && (
        // D-26: con una versión nueva en producción, el pedido no avanza hasta que se apruebe.
        <p role="status">Requiere nueva aprobación del cliente: no puede pasar a listo para retirar ni despacharse.</p>
      )}
      {order.estado === "CONFIRMADO" && (
        <>
          {custom && !designsApproved && <p>Para pasar a producción hace falta la aprobación del cliente de la versión vigente (RN-07).</p>}
          <StartProductionButton orderId={order.id} />
        </>
      )}
      {custom && order.estado === "EN_DEFINICION" && (
        <>
          <h2>{custom.cotizaciones.some((quote) => quote.estado === "PROPUESTA") ? "Reemplazar la cotización" : "Cotizar"}</h2>
          <p>Los materiales no se reservan: su disponibilidad se confirma a mano antes de producir (D-14, D-18).</p>
          <CustomQuoteForm orderId={order.id} shipping={order.modalidadEntrega === "ENVIO"} mode="quote" />
        </>
      )}
      {custom && order.estado === "VENCIDO" && !custom.reemision && (
        <>
          <h2>Reemitir la cotización</h2>
          <p>El pedido venció sin seña y no se reabre: se crea uno nuevo, vinculado, con la misma solicitud (D-42).</p>
          <CustomQuoteForm orderId={order.id} shipping={order.modalidadEntrega === "ENVIO"} mode="reissue" />
        </>
      )}
      {custom && order.senaCentavos !== null && <p>Seña: {formatPesos(order.senaCentavos)} (20 % de los productos, sin envío).</p>}
      {custom && balance > 0 && !["EN_DEFINICION", "PENDIENTE_PAGO", "RESERVADO", "CANCELADO", "VENCIDO"].includes(order.estado) && (
        <>
          <p>Saldo pendiente: {formatPesos(balance)}. No se puede despachar ni entregar hasta cobrarlo (RN-21).</p>
          {/* El saldo en efectivo se registra al retirar (RN-21). */}
          {order.estado === "LISTO_PARA_RETIRO" && order.modalidadEntrega === "RETIRO" && (
            <CashPaymentButton orderId={order.id} total={formatPesos(balance)} />
          )}
        </>
      )}
      {order.estado === "VENCIDO" && order.modalidadCierre === "EFECTIVO" && order.tipo === "ESTANDAR" && (
        <>
          <h2>Reactivar la reserva</h2>
          <ReactivateReservation orderId={order.id} />
        </>
      )}

      <h2>Fecha comprometida</h2>
      {order.fechaDespachoComprometida ? (
        <p>
          Listo para retirar el {formatDateTime(order.fechaDespachoComprometida)}. Cancelar tiene cargo desde el{" "}
          {formatDateTime(order.inicioVentanaCargo!)}
          {order.ventanaCargoFija && " (fija: la fecha se confirmó con 48 h o menos)"}.
        </p>
      ) : (
        <p>Sin fecha confirmada: todavía no hay cargo por cancelar.</p>
      )}
      {(order.estado === "CONFIRMADO" || order.estado === "EN_PRODUCCION") && (
        <DispatchDateForm orderId={order.id} hasDate={order.fechaDespachoComprometida !== null} />
      )}

      <h2>Cancelación</h2>
      {order.cancelacion ? (
        <>
          <p>
            {order.cancelacion.rol === "TIENDA" ? "Por la tienda" : "Por el cliente"} el {formatDateTime(order.cancelacion.creadoEn)}, desde{" "}
            {ORDER_STATUS_LABELS[order.cancelacion.estadoPrevio]}: {order.cancelacion.motivo}. Consecuencias: {order.cancelacion.consecuencias}.
            {order.cancelacion.rol === "TIENDA" && " Corresponde un cupón de compensación: se emite cuando esté el módulo de cupones."}
          </p>
          <CancellationBreakdown breakdown={order.cancelacion} />
        </>
      ) : FINAL_STATES.includes(order.estado) ? (
        <p>Este pedido ya no se puede cancelar.</p>
      ) : (
        <StoreCancelForm orderId={order.id} />
      )}
      {order.ajustes.map((adjustment) => (
        <section key={adjustment.id}>
          <p>
            {ADJUSTMENT_LABELS[adjustment.tipo]}: {formatPesos(adjustment.importeCentavos)} · {ADJUSTMENT_LABELS[adjustment.estado]}
            {adjustment.notaCierre && ` · ${adjustment.notaCierre}`}
          </p>
          <AdjustmentActions
            adjustmentId={adjustment.id}
            estado={adjustment.estado}
            costoRealEstimadoCentavos={adjustment.costoRealEstimadoCentavos}
          />
        </section>
      ))}
      {order.reembolsos.map((refund) => (
        <section key={refund.id}>
          <p>
            Devolución de {formatPesos(refund.importeCentavos)}
            {refund.incluyeEnvio && " (incluye el envío)"} · {REFUND_LABELS[refund.estado]}
            {refund.notaCierre && ` · ${refund.notaCierre}`}
          </p>
          <RefundActions refundId={refund.id} estado={refund.estado} />
        </section>
      ))}

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

      <h2>Pagos</h2>
      {order.pagos.length === 0 ? (
        <p>Sin pagos registrados.</p>
      ) : (
        <ul>
          {order.pagos.map((payment) => (
            <li key={payment.id}>
              {formatDateTime(payment.creadoEn)} · {payment.medio === "ONLINE" ? "Online" : "Efectivo"}
              {payment.simulado && " (SIMULADO)"} · {PAYMENT_STATUS_LABELS[payment.estado]} · {formatPesos(payment.importeCentavos)}
            </li>
          ))}
        </ul>
      )}

      <h2>Historial</h2>
      <ul>
        {order.historial.map((entry) => (
          <li key={entry.id}>
            {formatDateTime(entry.creadoEn)} · {entry.estadoAnterior ? `${ORDER_STATUS_LABELS[entry.estadoAnterior]} → ` : ""}
            {ORDER_STATUS_LABELS[entry.estadoNuevo]}
          </li>
        ))}
      </ul>
    </main>
  );
}
