import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatThread } from "@/app/chat/chat-thread";
import { requireAdminPage } from "@/app/session";
import { getStoreConversation } from "@/server/modules/chat/chat.service";
import { AppError } from "@/server/shared/errors";
import { PageHeader } from "../../page-header";

export const dynamic = "force-dynamic";

/** Conversación con un cliente (F-07): la tienda responde, adjunta y asocia el mensaje a un pedido. */
export default async function AdminConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ clienteId: string }>;
  searchParams: Promise<{ pedido?: string }>;
}) {
  await requireAdminPage();
  const { clienteId } = await params;
  const { cliente, pedidos, mensajes } = await getStoreConversation(clienteId).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const pedido = (await searchParams).pedido;

  return (
    <main>
      <Link href="/admin/mensajes" className="ink-btn">
        <ChevronLeft aria-hidden="true" size={18} />
        Mensajes
      </Link>
      <PageHeader title={cliente.nombre} description={cliente.email} />
      <ChatThread
        endpoint={`/api/admin/conversations/${clienteId}/messages`}
        readEndpoint={`/api/admin/conversations/${clienteId}/read`}
        asStore
        initialMessages={mensajes}
        orders={pedidos}
        orderBasePath="/admin/pedidos/"
        initialOrderId={pedidos.some((order) => order.id === pedido) ? pedido : undefined}
      />
    </main>
  );
}
