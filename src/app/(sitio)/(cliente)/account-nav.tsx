import { getPageUser } from "@/app/session";
import { unreadForClient } from "@/server/modules/chat/chat.service";
import { AccountTabs } from "./account-tabs";

/** Navegación del área del cliente con los mensajes sin leer de la tienda. */
export async function AccountNav() {
  const user = await getPageUser();
  const unread = user?.rol === "CLIENTE" ? await unreadForClient(user.id) : 0;
  return <AccountTabs unread={unread} />;
}
