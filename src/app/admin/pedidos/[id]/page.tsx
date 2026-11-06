import { AlertTriangle, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { StatusBadge } from "@/app/ui/status-badge";
import { ORDER_FAMILY, PAYMENT_FAMILY } from "@/lib/status";
import { CancellationBreakdown } from "@/app/cancellation-breakdown";
import { CustomOrderDetails } from "@/app/custom-order-details";
import { ReceiptsList } from "@/app/receipts-list";
import { DESIGN_STATUS_LABELS, DesignHistory } from "@/app/design-history";
import { requireAdminPage } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, paymentWindowOpen } from "@/lib/orders";
import { getOrderDesigns } from "@/server/modules/designs/design.service";
import { getCustomOrderDetails } from "@/server/modules/orders/custom-order.service";
import { isDispatchLate } from "@/server/modules/orders/delivery.service";
import { getAdminOrder } from "@/server/modules/orders/orders.service";
import { AppError } from "@/server/shared/errors";
import { AdjustmentActions, RefundActions, StoreCancelForm } from "./cancellation-actions";
import { CashPaymentButton } from "./cash-payment-button";
import { CustomQuoteForm } from "./custom-quote-form";
import { DesignVersionForm, StartProductionButton } from "./design-admin";
import { DelayCompensationForm, DeliveryStepButton, DispatchForm } from "./delivery-actions";
import { DispatchDateForm } from "./dispatch-date-form";
import { ReceiptForm } from "./receipt-form";
import styles from "./order-detail.module.css";
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
  COMPENSACION_DEMORA: "Compensación por demora",
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

// Concepto de cada pago (Documento Maestro, 12.4): el dato ya se guarda en el pago.
const PAYMENT_CONCEPT: Record<string, string> = { TOTAL: "Total", SENA: "Seña", SALDO: "Saldo" };

const FINAL_STATES = ["CANCELADO", "VENCIDO", "DESPACHADO", "ENTREGADO"];

/** Sección del detalle con su ancla en el índice. */
function Section({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className={styles.section}>
      <h2 id={`${id}-titulo`}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Detalle administrativo del pedido (F8): encabezado compacto con el estado, índice fijo de las secciones
 * y la operación completa agrupada por tema. Solo presentación: los datos y las acciones son los de siempre.
 */
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
  const balanceDue =
    custom !== null && balance > 0 && !["EN_DEFINICION", "PENDIENTE_PAGO", "RESERVADO", "CANCELADO", "VENCIDO"].includes(order.estado);
  const address = order.direccionEnvio as {
    calle: string;
    ciudad: string;
    provincia: string;
    codigoPostal: string;
    referencias: string | null;
  } | null;
  const quoteOpen = (order.estado === "ENVIO_A_COTIZAR" || order.estado === "ENVIO_COTIZADO") && order.venceEn! > new Date();
  // La tienda tiene que cotizar: el envío pedido o un personalizado sin cotización vigente.
  const quotePending =
    (order.estado === "ENVIO_A_COTIZAR" && quoteOpen) ||
    (custom !== null && order.estado === "EN_DEFINICION" && !custom.cotizaciones.some((quote) => quote.estado === "PROPUESTA"));
  const lastChange = order.historial.at(-1);
  // RN-04: despachado después de la fecha comprometida.
  const late = isDispatchLate(order.fechaDespachoComprometida, order.entrega?.despachadoEn);
  const production = designs.length > 0 || order.estado === "CONFIRMADO";
  const productionTitle = custom ? "Diseños y producción" : "Producción";

  const index = [
    { id: "estado", label: "Pedido y estado" },
    { id: "productos", label: "Productos" },
    ...(custom ? [{ id: "personalizado", label: "Cotización" }] : []),
    ...(production ? [{ id: "produccion", label: productionTitle }] : []),
    { id: "entrega", label: "Entrega" },
    { id: "pagos", label: "Pagos" },
    { id: "comprobantes", label: "Comprobantes" },
    { id: "cancelacion", label: "Cancelación y devoluciones" },
    { id: "historial", label: "Historial" },
  ];

  return (
    <main className={styles.page}>
      <header id="estado" className={styles.header} aria-labelledby="estado-titulo">
        <Link href="/admin/pedidos" className={styles.back}>
          <ChevronLeft aria-hidden="true" size={18} />
          Pedidos
        </Link>
        <div className={styles.titleRow}>
          <h1 id="estado-titulo">Pedido #{order.numero}</h1>
          <StatusBadge family={ORDER_FAMILY[order.estado] ?? "neutral"}>{ORDER_STATUS_LABELS[order.estado] ?? order.estado}</StatusBadge>
          {late && (
            <span className={styles.warning}>
              <AlertTriangle aria-hidden="true" size={16} />
              Posible compensación por demora
            </span>
          )}
          {quotePending && (
            <span className={styles.warning}>
              <AlertTriangle aria-hidden="true" size={16} />
              Presupuesto pendiente
            </span>
          )}
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Cliente</dt>
            <dd>
              {order.cliente.nombre}
              <span className={styles.muted}>
                {order.cliente.email}
                {order.cliente.telefono && ` · ${order.cliente.telefono}`}
              </span>
              {/* F-07: la tienda responde desde la vista del pedido. */}
              <Link href={`/admin/mensajes/${order.clienteId}?pedido=${order.id}`} className={styles.chatLink}>
                Escribirle al cliente
              </Link>
            </dd>
          </div>
          <div>
            <dt>Pago y entrega</dt>
            <dd>
              {order.modalidadCierre === "ONLINE" ? "Pago online" : "Pago en efectivo"}
              <span className={styles.muted}>{order.modalidadEntrega === "ENVIO" ? "Envío a domicilio" : "Retiro en el local"}</span>
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>
              <strong>{formatPesos(order.totalCentavos)}</strong>
              {lastChange && <span className={styles.muted}>Actualizado el {formatDateTime(lastChange.creadoEn)}</span>}
            </dd>
          </div>
          {balanceDue && (
            <div className={styles.balanceFact}>
              <dt>Saldo pendiente</dt>
              <dd>
                <a href="#pagos">{formatPesos(balance)}</a>
              </dd>
            </div>
          )}
        </dl>
      </header>

      <nav aria-label="Secciones del pedido" className={styles.index}>
        <ul>
          {index.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`}>{item.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="productos" title="Productos">
        <ul className={styles.lines}>
          {order.items.map((item) => (
            <li key={item.id}>
              <span>
                {item.descripcion} × {item.cantidad}
              </span>
              <span>{formatPesos(item.precioUnitarioCentavos * item.cantidad)}</span>
            </li>
          ))}
          {order.descuentoCuponCentavos > 0 && (
            <li>
              <span>Cupón</span>
              <span>−{formatPesos(order.descuentoCuponCentavos)}</span>
            </li>
          )}
          {order.costoEnvioCentavos > 0 && (
            <li>
              <span>Envío</span>
              <span>{formatPesos(order.costoEnvioCentavos)}</span>
            </li>
          )}
          <li className={styles.total}>
            <span>Total</span>
            <strong>{formatPesos(order.totalCentavos)}</strong>
          </li>
        </ul>
      </Section>

      {custom && (
        <Section id="personalizado" title="Cotización">
          <CustomOrderDetails details={custom} orderHref={(id) => `/admin/pedidos/${id}`} />
          {order.estado === "EN_DEFINICION" && (
            <div className={custom.cotizaciones.some((quote) => quote.estado === "PROPUESTA") ? styles.secondary : undefined}>
              <h3>{custom.cotizaciones.some((quote) => quote.estado === "PROPUESTA") ? "Reemplazar la cotización" : "Cotizar"}</h3>
              <p>Los materiales no se reservan: su disponibilidad se confirma a mano antes de producir (D-14, D-18).</p>
              <CustomQuoteForm orderId={order.id} shipping={order.modalidadEntrega === "ENVIO"} mode="quote" />
            </div>
          )}
          {order.estado === "VENCIDO" && !custom.reemision && (
            <>
              <h3>Reemitir la cotización</h3>
              <p>El pedido venció sin seña y no se reabre: se crea uno nuevo, vinculado, con la misma solicitud (D-42).</p>
              <CustomQuoteForm orderId={order.id} shipping={order.modalidadEntrega === "ENVIO"} mode="reissue" />
            </>
          )}
        </Section>
      )}

      {production && (
        <Section id="produccion" title={productionTitle}>
          {designs.map((item) => (
            <div key={item.id} className={styles.design}>
              <h3>Diseño: {item.descripcion}</h3>
              <p>{DESIGN_STATUS_LABELS[item.diseno?.estado ?? "SIN_PROPUESTA"]}</p>
              {item.diseno && <DesignHistory design={item.diseno} />}
              {designOpen && <DesignVersionForm itemId={item.id} />}
            </div>
          ))}
          {custom && order.estado === "EN_PRODUCCION" && !designsApproved && (
            // D-26: con una versión nueva en producción, el pedido no avanza hasta que se apruebe.
            <p role="status" className={styles.notice}>
              Requiere nueva aprobación del cliente: no puede pasar a listo para retirar ni despacharse.
            </p>
          )}
          {order.estado === "CONFIRMADO" && (
            <div className={styles.actions}>
              {custom && !designsApproved && <p>Para pasar a producción hace falta la aprobación del cliente de la versión vigente (RN-07).</p>}
              <StartProductionButton orderId={order.id} />
            </div>
          )}
        </Section>
      )}

      <Section id="entrega" title="Entrega">
        <p>{order.modalidadEntrega === "ENVIO" ? "Envío a domicilio" : "Retiro en el local"}</p>
        {address && (
          <>
            <p>
              Dirección: {address.calle}, {address.ciudad}, {address.provincia} ({address.codigoPostal})
              {address.referencias && ` · ${address.referencias}`}
            </p>
            {order.cotizacionesEnvio.length > 0 && (
              <>
                <h3>Cotizaciones del envío</h3>
                <ul>
                  {order.cotizacionesEnvio.map((quote) => (
                    <li key={quote.id}>
                      {formatDateTime(quote.creadoEn)} · {quote.importeCentavos === null ? "No se puede enviar" : formatPesos(quote.importeCentavos)}
                      {quote.nota && ` · ${quote.nota}`} · {QUOTE_STATUS_LABELS[quote.estado]}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {quoteOpen && (
              <div className={order.estado === "ENVIO_COTIZADO" ? styles.secondary : undefined}>
                <p>
                  {order.estado === "ENVIO_A_COTIZAR" ? "Cotizá el envío" : "El cliente tiene que responder"} antes del{" "}
                  {formatDateTime(order.venceEn!)}; después el pedido se cancela.
                </p>
                <ShippingQuoteForm orderId={order.id} hasQuote={order.estado === "ENVIO_COTIZADO"} />
              </div>
            )}
          </>
        )}
        <h3>Fecha comprometida</h3>
        {order.fechaDespachoComprometida ? (
          <p>
            {order.modalidadEntrega === "ENVIO" ? "Se despacha el" : "Listo para retirar el"} {formatDateTime(order.fechaDespachoComprometida)}.
            Cancelar tiene cargo desde el {formatDateTime(order.inicioVentanaCargo!)}
            {order.ventanaCargoFija && " (fija: la fecha se confirmó con 48 h o menos)"}.
          </p>
        ) : (
          <p>Sin fecha confirmada: todavía no hay cargo por cancelar.</p>
        )}
        {(order.estado === "CONFIRMADO" || order.estado === "EN_PRODUCCION") && (
          <div className={order.fechaDespachoComprometida !== null ? styles.secondary : undefined}>
            <DispatchDateForm orderId={order.id} hasDate={order.fechaDespachoComprometida !== null} />
          </div>
        )}

        <h3>Seguimiento</h3>
        {late && (
          <p className={styles.notice}>
            Se despachó después de la fecha comprometida: posible compensación por demora (RN-04). La decide y la carga la tienda.
          </p>
        )}
        {order.entrega?.listoEn && <p>Listo para retirar desde el {formatDateTime(order.entrega.listoEn)}.</p>}
        {order.entrega?.despachadoEn && (
          <p>
            Despachado el {formatDateTime(order.entrega.despachadoEn)}
            {order.entrega.transportista && ` · ${order.entrega.transportista}`}
            {order.entrega.codigoSeguimiento && ` · seguimiento ${order.entrega.codigoSeguimiento}`}.
          </p>
        )}
        {order.entrega?.entregadoEn && <p>Entregado el {formatDateTime(order.entrega.entregadoEn)}.</p>}
        {late && (
          <div className={styles.secondary}>
            <h3>Compensación por demora</h3>
            <p className={styles.muted}>No hay cálculo automático (D-05): el importe lo decide la tienda y no puede superar lo pagado.</p>
            <DelayCompensationForm orderId={order.id} />
          </div>
        )}
        {!order.entrega && <p className={styles.muted}>Todavía no se registró ningún paso de la entrega.</p>}
        {(order.estado === "CONFIRMADO" || order.estado === "EN_PRODUCCION") && (
          <div className={styles.actions}>
            {order.modalidadEntrega === "RETIRO" ? (
              <DeliveryStepButton orderId={order.id} step="LISTO_PARA_RETIRO" />
            ) : (
              <DispatchForm orderId={order.id} dispatched={false} />
            )}
          </div>
        )}
        {order.estado === "DESPACHADO" && (
          <div className={styles.secondary}>
            <DispatchForm
              orderId={order.id}
              dispatched
              transportista={order.entrega?.transportista}
              codigoSeguimiento={order.entrega?.codigoSeguimiento}
            />
          </div>
        )}
        {(order.estado === "LISTO_PARA_RETIRO" || order.estado === "DESPACHADO") && (
          <div className={styles.actions}>
            <DeliveryStepButton orderId={order.id} step="ENTREGADO" />
          </div>
        )}
      </Section>

      <Section id="pagos" title="Pagos">
        {balanceDue && (
          <div className={styles.balance}>
            <p>
              Saldo pendiente: <strong>{formatPesos(balance)}</strong>. No se puede despachar ni entregar hasta cobrarlo (RN-21).
            </p>
            {/* El saldo en efectivo se registra al retirar (RN-21). */}
            {order.estado === "LISTO_PARA_RETIRO" && order.modalidadEntrega === "RETIRO" && (
              <CashPaymentButton orderId={order.id} total={formatPesos(balance)} />
            )}
          </div>
        )}
        {custom && order.senaCentavos !== null && <p>Seña: {formatPesos(order.senaCentavos)} (20 % de los productos, sin envío).</p>}
        {order.estado === "RESERVADO" &&
          (paymentWindowOpen(order) ? (
            <>
              <p>La reserva vence el {formatDateTime(order.venceEn!)}.</p>
              <CashPaymentButton orderId={order.id} total={formatPesos(custom ? (order.senaCentavos ?? 0) : order.totalCentavos)} />
              <div className={styles.secondary}>
                <h3>Extender la reserva</h3>
                <ExtendReservationForm orderId={order.id} />
              </div>
            </>
          ) : (
            <p>La reserva venció: no se puede registrar el pago.</p>
          ))}
        {order.estado === "VENCIDO" && order.modalidadCierre === "EFECTIVO" && order.tipo === "ESTANDAR" && (
          <>
            <h3>Reactivar la reserva</h3>
            <ReactivateReservation orderId={order.id} />
          </>
        )}
        {order.pagos.length === 0 ? (
          <p className={styles.muted}>Sin pagos registrados.</p>
        ) : (
          // Cada intento queda a la vista; los no aprobados se diferencian sin ocultarse (12.4).
          <ul className={styles.payments}>
            {order.pagos.map((payment) => (
              <li key={payment.id}>
                <StatusBadge family={PAYMENT_FAMILY[payment.estado] ?? "neutral"}>
                  {PAYMENT_STATUS_LABELS[payment.estado] ?? payment.estado}
                </StatusBadge>
                <span>
                  {PAYMENT_CONCEPT[payment.concepto]} · {formatDateTime(payment.creadoEn)} · {payment.medio === "ONLINE" ? "Online" : "Efectivo"}
                  {payment.simulado && " (SIMULADO)"}
                </span>
                <strong>{formatPesos(payment.importeCentavos)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="comprobantes" title="Comprobantes">
        <p className={styles.muted}>Facturas y notas de crédito emitidas fuera del sistema (RN-26). El cliente las ve en su pedido.</p>
        {order.comprobantes.length > 0 ? <ReceiptsList receipts={order.comprobantes} /> : <p>Todavía no se registró ningún comprobante.</p>}
        <div className={styles.secondary}>
          <h3>Registrar un comprobante</h3>
          <ReceiptForm
            orderId={order.id}
            allowCreditNote={order.estado === "CANCELADO" && order.comprobantes.some((receipt) => receipt.tipo === "FACTURA")}
          />
        </div>
      </Section>

      <Section id="cancelacion" title="Cancelación y devoluciones">
        {order.cancelacion ? (
          <>
            <p>
              {order.cancelacion.rol === "TIENDA" ? "Por la tienda" : "Por el cliente"} el {formatDateTime(order.cancelacion.creadoEn)}, desde{" "}
              {ORDER_STATUS_LABELS[order.cancelacion.estadoPrevio]}: {order.cancelacion.motivo}. Consecuencias: {order.cancelacion.consecuencias}.
              {order.cancelacion.rol === "TIENDA" && (
                <>
                  {" "}
                  Se emitió un cupón de compensación para el cliente (RN-19): lo ves en <Link href="/admin/cupones">Cupones</Link>.
                </>
              )}
            </p>
            <CancellationBreakdown breakdown={order.cancelacion} />
          </>
        ) : FINAL_STATES.includes(order.estado) ? (
          <p>Este pedido ya no se puede cancelar.</p>
        ) : (
          <StoreCancelForm orderId={order.id} />
        )}
        {order.ajustes.map((adjustment) => (
          <div key={adjustment.id} className={`${styles.record} ${styles.secondary}`}>
            {adjustment.tipo === "COMPENSACION_DEMORA" ? (
              // D-05: la devolución que genera figura abajo, con sus acciones.
              <p>
                {ADJUSTMENT_LABELS[adjustment.tipo]}: {formatPesos(adjustment.importeCentavos)} · autorizada por {adjustment.autorizadoPor} el{" "}
                {formatDateTime(adjustment.creadoEn)} · {adjustment.justificacion}
              </p>
            ) : (
              <>
                <p>
                  {ADJUSTMENT_LABELS[adjustment.tipo]}: {formatPesos(adjustment.importeCentavos)} · {ADJUSTMENT_LABELS[adjustment.estado]}
                  {adjustment.notaCierre && ` · ${adjustment.notaCierre}`}
                </p>
                <AdjustmentActions
                  adjustmentId={adjustment.id}
                  estado={adjustment.estado}
                  costoRealEstimadoCentavos={adjustment.costoRealEstimadoCentavos}
                />
              </>
            )}
          </div>
        ))}
        {order.reembolsos.map((refund) => (
          <div key={refund.id} className={`${styles.record} ${styles.secondary}`}>
            <p>
              Devolución de {formatPesos(refund.importeCentavos)}
              {refund.incluyeEnvio && " (incluye el envío)"} · {refund.motivo} · {REFUND_LABELS[refund.estado]}
              {refund.notaCierre && ` · ${refund.notaCierre}`}
            </p>
            <RefundActions refundId={refund.id} estado={refund.estado} />
          </div>
        ))}
      </Section>

      <Section id="historial" title="Historial">
        <ol className={styles.history}>
          {order.historial.map((entry) => (
            <li key={entry.id}>
              <span className={styles.muted}>{formatDateTime(entry.creadoEn)}</span>
              <span>
                {entry.estadoAnterior ? `${ORDER_STATUS_LABELS[entry.estadoAnterior]} → ` : ""}
                {ORDER_STATUS_LABELS[entry.estadoNuevo]}
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </main>
  );
}
