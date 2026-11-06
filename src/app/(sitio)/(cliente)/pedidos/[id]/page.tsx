import type { Metadata } from "next";
import { ChevronLeft, MessageSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancellationBreakdown } from "@/app/cancellation-breakdown";
import { CustomOrderDetails } from "@/app/custom-order-details";
import { DesignHistory } from "@/app/design-history";
import { ReceiptsList } from "@/app/receipts-list";
import { requirePageUser } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { StatusBadge } from "@/app/ui/status-badge";
import { formatDateTime, paymentWindowOpen } from "@/lib/orders";
import { DESIGN_FAMILY, DESIGN_PUBLIC_LABELS, ORDER_FAMILY, orderPublicLabel, PAYMENT_FAMILY, PAYMENT_PUBLIC_LABELS } from "@/lib/status";
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
import { AccountNav } from "../../account-nav";
import styles from "./order.module.css";
import { SimulatedPayment } from "./simulated-payment";

export const dynamic = "force-dynamic";

// Concepto de cada pago (Documento Maestro, 12.4): el dato ya se guarda en el pago.
const PAYMENT_CONCEPT: Record<string, string> = { TOTAL: "Total", SENA: "Seña", SALDO: "Saldo" };

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
  // Estado actual (5.6): fecha real del último cambio y, para VENCIDO, el motivo del último vencimiento (12.3).
  const lastChange = order.historial.at(-1);
  const lastExpiry = [...order.historial].reverse().find((entry) => entry.estadoNuevo === "VENCIDO");
  const windowStarted = order.inicioVentanaCargo !== null && (order.ventanaCargoFija || order.inicioVentanaCargo <= new Date());

  return (
    <main className={styles.page}>
      <AccountNav />
      <header className={styles.header}>
        <Link href="/pedidos" className={styles.back}>
          <ChevronLeft aria-hidden="true" size={18} />
          Mis pedidos
        </Link>
        <div className={styles.titleRow}>
          <h1>Pedido #{order.numero}</h1>
          <StatusBadge family={ORDER_FAMILY[order.estado] ?? "neutral"}>{orderPublicLabel(order.estado, order.tipo, lastExpiry?.motivo)}</StatusBadge>
        </div>
        <p className={styles.meta}>
          {order.modalidadEntrega === "ENVIO" ? "Envío a domicilio" : "Retiro en el local"}
          {lastChange && ` · Actualizado el ${formatDateTime(lastChange.creadoEn)}`}
        </p>
        {user.rol === "CLIENTE" && (
          <Link href={`/mensajes?pedido=${order.id}`} className={`ink-btn ${styles.ask}`}>
            <MessageSquare aria-hidden="true" size={18} />
            Consultar a la tienda
          </Link>
        )}
      </header>

      <div className={styles.layout}>
        <div className={styles.column}>
          {/* Lo que hay que hacer ahora: avisos destacados, cada uno con su acción. */}
          {order.estado === "ENVIO_A_COTIZAR" && (
            <div className={styles.callout}>
              <p>La tienda te envía el costo del envío antes del {formatDateTime(order.venceEn!)}.</p>
            </div>
          )}
          {order.estado === "ENVIO_COTIZADO" &&
            (quote?.cotizacion ? (
              <div className={styles.callout} data-tone="action">
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
              </div>
            ) : (
              <div className={styles.callout}>
                <p>El plazo para responder la cotización del envío venció.</p>
              </div>
            ))}
          {order.estado === "EN_DEFINICION" &&
            (pendingQuote ? (
              <div className={styles.callout} data-tone="action">
                <QuoteResponse orderId={order.id} shipping={order.modalidadEntrega === "ENVIO"} hasPhone={user.telefono !== null} />
              </div>
            ) : (
              <div className={styles.callout}>
                <p>La tienda está preparando la cotización. Te avisamos cuando esté lista.</p>
              </div>
            ))}
          {custom && order.senaCentavos !== null && (order.estado === "PENDIENTE_PAGO" || order.estado === "RESERVADO") && (
            <div className={styles.callout}>
              <p>
                Seña a pagar: <strong>{formatPesos(order.senaCentavos)}</strong> (20 % de los productos). El resto se paga como saldo.
              </p>
            </div>
          )}
          {balancePayable && (
            <div className={styles.callout} data-tone="action">
              <p>
                Saldo pendiente: <strong>{formatPesos(balance)}</strong>
                {order.modalidadEntrega === "ENVIO"
                  ? " (incluye el envío); se paga antes del despacho."
                  : "; podés pagarlo online o en efectivo al retirar."}
              </p>
              {getConfig().PAYMENTS_MODE === "simulado" && <SimulatedPayment orderId={order.id} />}
            </div>
          )}
          {order.estado === "PENDIENTE_PAGO" &&
            (open ? (
              <div className={styles.callout} data-tone="action">
                <p>Completá el pago antes del {formatDateTime(order.venceEn!)}.</p>
                {getConfig().PAYMENTS_MODE === "simulado" && <SimulatedPayment orderId={order.id} />}
              </div>
            ) : (
              <div className={styles.callout}>
                <p>El plazo para pagar venció.</p>
              </div>
            ))}
          {order.estado === "RESERVADO" &&
            (open ? (
              <div className={styles.callout} data-tone="action">
                <p>Pagá en efectivo en el local antes del {formatDateTime(order.venceEn!)}. Después la reserva vence.</p>
                {contact && (contact.emailContacto || contact.telefonoContacto) && (
                  <p>Contacto de la tienda: {[contact.emailContacto, contact.telefonoContacto].filter(Boolean).join(" · ")}</p>
                )}
              </div>
            ) : (
              <div className={styles.callout}>
                <p>El plazo de la reserva venció.</p>
              </div>
            ))}

          {custom && (
            <section className={styles.card} aria-label="Tu pedido personalizado">
              <CustomOrderDetails details={custom} orderHref={(id) => `/pedidos/${id}`} />
            </section>
          )}
          {designs.map((item) => {
            const design = item.diseno;
            const current = design?.versiones.find((version) => version.id === design.versionVigenteId);
            return (
              <section key={item.id} aria-label="Diseño" className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>Diseño: {item.descripcion}</h2>
                  <StatusBadge family={DESIGN_FAMILY[design?.estado ?? "SIN_PROPUESTA"] ?? "neutral"}>
                    {DESIGN_PUBLIC_LABELS[design?.estado ?? "SIN_PROPUESTA"]!}
                  </StatusBadge>
                </div>
                {design && <DesignHistory design={design} />}
                {designOpen && current && !current.aprobacion && design?.estado === "PENDIENTE_APROBACION" && (
                  <DesignReview versionId={current.id} numero={current.numero} huella={current.huella} />
                )}
              </section>
            );
          })}

          {order.cancelacion && (
            <section className={styles.card} aria-labelledby="cancelacion-titulo">
              <h2 id="cancelacion-titulo">Cancelación</h2>
              <p>
                {order.cancelacion.rol === "TIENDA" ? "Cancelado por la tienda" : "Cancelado por vos"} el {formatDateTime(order.cancelacion.creadoEn)}
                : {order.cancelacion.motivo}
              </p>
              <CancellationBreakdown breakdown={order.cancelacion} />
            </section>
          )}

          <section className={styles.card} aria-labelledby="historial-titulo">
            <h2 id="historial-titulo">Historial</h2>
            <ol className={styles.history}>
              {[...order.historial].reverse().map((entry) => (
                <li key={entry.id}>
                  <strong>{orderPublicLabel(entry.estadoNuevo, order.tipo, entry.motivo)}</strong>
                  <span className={styles.muted}>{formatDateTime(entry.creadoEn)}</span>
                </li>
              ))}
            </ol>
          </section>

          {(cancellable || (contactToCancel && contact)) && (
            <div className={styles.cancelZone}>
              {cancellable && <CancelOrder orderId={order.id} />}
              {contactToCancel && contact && (
                <p>
                  Para cancelar este pedido comunicate con la tienda:{" "}
                  {[contact.emailContacto, contact.telefonoContacto].filter(Boolean).join(" · ") || "datos de contacto no cargados"}.
                </p>
              )}
            </div>
          )}
        </div>

        <aside className={styles.aside}>
          <section className={styles.card} aria-labelledby="resumen-titulo">
            <h2 id="resumen-titulo">Resumen</h2>
            <ul className={styles.lines}>
              {order.items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.descripcion} <span className={styles.muted}>× {item.cantidad}</span>
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
            </ul>
            <p className={styles.total}>
              <span>Total</span>
              <strong>{formatPesos(order.totalCentavos)}</strong>
            </p>
          </section>

          <section className={styles.card} aria-labelledby="entrega-titulo">
            <h2 id="entrega-titulo">Entrega</h2>
            <p>{order.modalidadEntrega === "ENVIO" ? "Envío a domicilio" : "Retiro en el local"}</p>
            {order.modalidadEntrega === "ENVIO" && address && (
              <p className={styles.muted}>
                {address.calle}, {address.ciudad}, {address.provincia} ({address.codigoPostal})
              </p>
            )}
            {order.fechaDespachoComprometida && ["CONFIRMADO", "EN_PRODUCCION"].includes(order.estado) && (
              <p className={styles.muted}>
                {order.modalidadEntrega === "ENVIO" ? "Se despacha el" : "Va a estar listo para retirar el"}{" "}
                {formatDateTime(order.fechaDespachoComprometida)}.{" "}
                {windowStarted
                  ? "Si lo cancelás ahora, se cobra un cargo por servicio."
                  : `Si lo cancelás a partir del ${formatDateTime(order.inicioVentanaCargo!)}, se cobra un cargo por servicio.`}
              </p>
            )}
            {/* Seguimiento del envío (RF-43): datos opcionales que carga la tienda al despachar. */}
            {order.entrega?.despachadoEn && (
              <p className={styles.muted}>
                Despachado el {formatDateTime(order.entrega.despachadoEn)}
                {order.entrega.transportista && ` · ${order.entrega.transportista}`}
                {order.entrega.codigoSeguimiento && ` · seguimiento ${order.entrega.codigoSeguimiento}`}.
              </p>
            )}
            {order.entrega?.entregadoEn && <p className={styles.muted}>Entregado el {formatDateTime(order.entrega.entregadoEn)}.</p>}
          </section>

          {order.pagos.length > 0 && (
            <section className={styles.card} aria-labelledby="pagos-titulo">
              <h2 id="pagos-titulo">Pagos</h2>
              {/* Cada intento queda a la vista; los no aprobados se diferencian sin ocultarse (12.4). */}
              <ul className={styles.payments}>
                {order.pagos.map((payment) => (
                  <li key={payment.id} className={payment.estado === "APROBADO" ? undefined : styles.paymentFailed}>
                    <span className={styles.paymentTop}>
                      <StatusBadge family={PAYMENT_FAMILY[payment.estado] ?? "neutral"}>
                        {PAYMENT_PUBLIC_LABELS[payment.estado] ?? payment.estado}
                      </StatusBadge>
                      <strong>{formatPesos(payment.importeCentavos)}</strong>
                    </span>
                    <span className={styles.muted}>
                      {PAYMENT_CONCEPT[payment.concepto]} · {formatDateTime(payment.creadoEn)} · {payment.medio === "ONLINE" ? "Online" : "Efectivo"}
                      {payment.simulado && " (SIMULADO)"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {order.comprobantes.length > 0 && (
            <section className={styles.card} aria-labelledby="comprobantes-titulo">
              <h2 id="comprobantes-titulo">Comprobantes</h2>
              <ReceiptsList receipts={order.comprobantes} />
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
