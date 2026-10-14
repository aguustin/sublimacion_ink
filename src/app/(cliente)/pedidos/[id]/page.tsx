import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/app/session";
import { formatPesos } from "@/lib/money";
import { formatDateTime, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, paymentWindowOpen } from "@/lib/orders";
import { getCustomerOrder } from "@/server/modules/orders/orders.service";
import { getConfig } from "@/server/shared/config";
import { AppError } from "@/server/shared/errors";
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

  return (
    <main>
      <h1>Pedido #{order.numero}</h1>
      <p>
        Estado: <strong>{ORDER_STATUS_LABELS[order.estado]}</strong> · Retiro en el local
      </p>

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
          <p>Pagá en efectivo en el local antes del {formatDateTime(order.venceEn!)}. Después la reserva vence.</p>
        ) : (
          <p>El plazo de la reserva venció.</p>
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
