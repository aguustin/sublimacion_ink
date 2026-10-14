import { notFound } from "next/navigation";
import { requireAdminPage } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, paymentWindowOpen } from "@/lib/orders";
import { getAdminOrder } from "@/server/modules/orders/orders.service";
import { AppError } from "@/server/shared/errors";
import { CashPaymentButton } from "./cash-payment-button";

export const dynamic = "force-dynamic";

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const order = await getAdminOrder((await params).id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });

  return (
    <main>
      <h1>Pedido #{order.numero}</h1>
      <p>
        Estado: <strong>{ORDER_STATUS_LABELS[order.estado]}</strong> · {order.modalidadCierre === "ONLINE" ? "Pago online" : "Pago en efectivo"} ·
        Retiro en el local
      </p>
      <p>
        Cliente: {order.cliente.nombre} · {order.cliente.email}
        {order.cliente.telefono && ` · ${order.cliente.telefono}`}
      </p>
      {order.estado === "RESERVADO" &&
        (paymentWindowOpen(order) ? (
          <>
            <p>La reserva vence el {formatDateTime(order.venceEn!)}.</p>
            <CashPaymentButton orderId={order.id} total={formatPesos(order.totalCentavos)} />
          </>
        ) : (
          <p>La reserva venció: no se puede registrar el pago.</p>
        ))}

      <h2>Productos</h2>
      <ul>
        {order.items.map((item) => (
          <li key={item.id}>
            {item.descripcion} × {item.cantidad} = {formatPesos(item.precioUnitarioCentavos * item.cantidad)}
          </li>
        ))}
      </ul>
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
