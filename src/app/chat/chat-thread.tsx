"use client";

import { Paperclip, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OpenFileButton } from "@/app/open-file-button";
import { fieldErrors, sendJson, type ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/orders";
import styles from "./chat.module.css";

export type ThreadMessage = {
  id: string;
  deTienda: boolean;
  texto: string;
  creadoEn: Date | string;
  leidoEn: Date | string | null;
  pedido: { id: string; numero: number } | null;
  adjuntos: { archivo: { id: string; nombreOriginal: string } }[];
};

/** 16.2: polling solo mientras la conversación está abierta y visible. */
const POLL_MS = 15_000;
const MAX_ATTACHMENTS = 5;

/**
 * Conversación cliente–tienda (F-07), la misma para los dos lados. `asStore` define qué mensajes son
 * propios; `endpoint` y `readEndpoint`, contra qué API se lee, se escribe y se marca como leído.
 */
export function ChatThread({
  endpoint,
  readEndpoint,
  asStore,
  initialMessages,
  orders,
  orderBasePath,
  initialOrderId,
}: {
  endpoint: string;
  readEndpoint: string;
  asStore: boolean;
  initialMessages: ThreadMessage[];
  orders: { id: string; numero: number }[];
  /** Ruta del detalle del pedido, sin el id: `/pedidos/` o `/admin/pedidos/`. */
  orderBasePath: string;
  initialOrderId?: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const isMine = (message: ThreadMessage) => message.deTienda === asStore;

  const markRead = useCallback(() => void sendJson("POST", readEndpoint), [readEndpoint]);

  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json();
    const next: ThreadMessage[] = body.mensajes;
    setMessages(next);
    // Mensajes nuevos de la otra parte, con la conversación a la vista: quedan leídos.
    if (next.some((message) => message.deTienda !== asStore && !message.leidoEn)) markRead();
  }, [endpoint, asStore, markRead]);

  useEffect(() => {
    if (initialMessages.some((message) => message.deTienda !== asStore && !message.leidoEn)) markRead();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [initialMessages, asStore, markRead, refresh]);

  // El último mensaje a la vista al abrir y con cada mensaje nuevo.
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const files = form.getAll("adjuntos").filter((file): file is File => file instanceof File && file.size > 0);
    if (files.length > MAX_ATTACHMENTS)
      return setError({ codigo: "DEMASIADOS_ADJUNTOS", mensaje: `Podés adjuntar hasta ${MAX_ATTACHMENTS} archivos.` });
    setPending(true);
    const archivoIds: string[] = [];
    for (const file of files) {
      const data = new FormData();
      data.set("archivo", file);
      data.set("contexto", "CHAT");
      const response = await fetch("/api/files", { method: "POST", body: data }).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (!response?.ok) {
        setPending(false);
        return setError(body ?? { codigo: "SIN_CONEXION", mensaje: "No pudimos subir el adjunto." });
      }
      archivoIds.push(body.archivo.id);
    }
    const result = await sendJson("POST", endpoint, { texto: form.get("texto"), pedidoId: form.get("pedidoId"), archivoIds });
    setPending(false);
    setError(result.ok ? null : result.error);
    if (result.ok) {
      formElement.reset();
      await refresh();
    }
  }

  const errors = fieldErrors(error);
  return (
    <div className={styles.thread}>
      {messages.length === 0 ? (
        <p className={styles.empty}>
          {asStore ? "Todavía no hay mensajes con este cliente." : "Todavía no hay mensajes. Escribinos tu consulta y te respondemos por acá."}
        </p>
      ) : (
        <ol ref={listRef} className={styles.messages} aria-live="polite">
          {messages.map((message) => (
            <li key={message.id} className={isMine(message) ? styles.mine : styles.theirs}>
              <span className={styles.author}>{message.deTienda ? "Tienda" : asStore ? "Cliente" : "Vos"}</span>
              <p className={styles.text}>{message.texto}</p>
              {message.pedido && (
                <Link href={`${orderBasePath}${message.pedido.id}`} className={styles.order}>
                  Pedido #{message.pedido.numero}
                </Link>
              )}
              {message.adjuntos.length > 0 && (
                <span className={styles.attachments}>
                  {message.adjuntos.map(({ archivo }) => (
                    <OpenFileButton key={archivo.id} fileId={archivo.id} name={archivo.nombreOriginal} />
                  ))}
                </span>
              )}
              <span className={styles.meta}>
                {formatDateTime(message.creadoEn)}
                {isMine(message) && message.leidoEn && " · Leído"}
              </span>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={onSubmit} noValidate className={styles.composer}>
        {error && <p role="alert">{Object.values(errors).join(" ") || error.mensaje}</p>}
        <label className={styles.textLabel}>
          Mensaje
          <textarea name="texto" maxLength={2000} required rows={3} />
        </label>
        <div className={styles.options}>
          {orders.length > 0 && (
            <label>
              Sobre el pedido (opcional)
              <select name="pedidoId" defaultValue={initialOrderId ?? ""}>
                <option value="">Ninguno</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    #{order.numero}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span className={styles.attachLabel}>
              <Paperclip aria-hidden="true" size={16} />
              Adjuntos (opcional, hasta {MAX_ATTACHMENTS})
            </span>
            <input name="adjuntos" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" />
          </label>
        </div>
        <button type="submit" disabled={pending} className={styles.send}>
          <Send aria-hidden="true" size={16} />
          {pending ? "Enviando…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}
