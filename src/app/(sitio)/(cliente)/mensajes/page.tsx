import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatThread } from "@/app/chat/chat-thread";
import { requirePageUser } from "@/app/session";
import { getClientMessages } from "@/server/modules/chat/chat.service";
import { listCustomerOrders } from "@/server/modules/orders/orders.service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mensajes · Sublimaciones", robots: { index: false } };

/** Chat con la tienda (RF-29, F-07). `?pedido=` deja elegido el pedido sobre el que se consulta. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const user = await requirePageUser();
  if (user.rol === "ADMIN") redirect("/admin/mensajes");
  const [messages, orders] = await Promise.all([getClientMessages(user), listCustomerOrders(user.id)]);
  const pedido = (await searchParams).pedido;

  return (
    <main>
      <h1>Mensajes</h1>
      <p>Consultá a la tienda sobre tus pedidos, diseños o cualquier duda. Podés adjuntar imágenes o PDF.</p>
      <ChatThread
        endpoint="/api/conversation/messages"
        readEndpoint="/api/conversation/read"
        asStore={false}
        initialMessages={messages}
        orders={orders.map(({ id, numero }) => ({ id, numero }))}
        orderBasePath="/pedidos/"
        initialOrderId={orders.some((order) => order.id === pedido) ? pedido : undefined}
      />
    </main>
  );
}
