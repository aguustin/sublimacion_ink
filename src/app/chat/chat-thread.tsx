"use client";

import { MessageCircle, Paperclip, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
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
  /** Oculto por la tienda (16.2). Al cliente le llega sin texto ni adjuntos, y sin el motivo. */
  ocultoEn: Date | string | null;
  motivoOculto: string | null;
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
  heading,
}: {
  endpoint: string;
  readEndpoint: string;
  asStore: boolean;
  initialMessages: ThreadMessage[];
  orders: { id: string; numero: number }[];
  /** Ruta del detalle del pedido, sin el id: `/pedidos/` o `/admin/pedidos/`. */
  orderBasePath: string;
  initialOrderId?: string;
  /** Encabezado de la conversación (la tienda, para el cliente). */
  heading?: { title: string; subtitle?: string; avatar: string };
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [fileCount, setFileCount] = useState(0);
  const idPrefix = useId();
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

  /** 16.2: la tienda oculta un mensaje con motivo; el cliente deja de ver su contenido. */
  async function hide(id: string) {
    const motivo = window.prompt("¿Por qué ocultás este mensaje? El motivo queda registrado y el cliente no lo ve.");
    if (motivo === null) return;
    const result = await sendJson("POST", `/api/admin/messages/${id}/hide`, { motivo });
    setError(result.ok ? null : result.error);
    if (result.ok) await refresh();
  }

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
      setFileCount(0);
      await refresh();
    }
  }

  const errors = fieldErrors(error);
  return (
    <div className={styles.thread}>
      {heading && (
        <div className={styles.head}>
          <span className={styles.avatar} aria-hidden="true">
            {heading.avatar}
          </span>
          <span className={styles.headText}>
            <strong>{heading.title}</strong>
            {heading.subtitle && <span>{heading.subtitle}</span>}
          </span>
        </div>
      )}

      <div className={styles.body}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <MessageCircle size={28} />
            </span>
            <p>{asStore ? "Todavía no hay mensajes con este cliente." : "Todavía no hay mensajes."}</p>
            {!asStore && <span>Escribinos tu consulta abajo y te respondemos por acá.</span>}
          </div>
        ) : (
          <ol ref={listRef} className={styles.messages} aria-live="polite">
            {messages.map((message) => (
              <li key={message.id} className={`${isMine(message) ? styles.mine : styles.theirs}${message.ocultoEn ? ` ${styles.hidden}` : ""}`}>
                <div className={styles.bubble}>
                  {message.ocultoEn && !asStore ? (
                    <p className={styles.text}>La tienda ocultó este mensaje.</p>
                  ) : (
                    <p className={styles.text}>{message.texto}</p>
                  )}
                  {message.ocultoEn && asStore && <p className={styles.hiddenNote}>Oculto para el cliente: {message.motivoOculto}</p>}
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
                </div>
                <span className={styles.meta}>
                  {message.deTienda ? "Tienda" : asStore ? "Cliente" : "Vos"} · {formatDateTime(message.creadoEn)}
                  {isMine(message) && message.leidoEn && " · Leído"}
                  {asStore && !message.ocultoEn && (
                    <button type="button" className={styles.hide} onClick={() => void hide(message.id)}>
                      Ocultar
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <form ref={formRef} onSubmit={onSubmit} noValidate className={styles.composer}>
        {error && <p role="alert">{Object.values(errors).join(" ") || error.mensaje}</p>}
        <label className={styles.srOnly} htmlFor={`${idPrefix}-texto`}>
          Mensaje
        </label>
        <textarea
          id={`${idPrefix}-texto`}
          name="texto"
          maxLength={2000}
          required
          rows={2}
          placeholder="Escribí tu mensaje…"
          className={styles.input}
          onKeyDown={(event) => {
            // Ctrl/Cmd + Enter envía; Enter solo, salto de línea.
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) formRef.current?.requestSubmit();
          }}
        />
        <div className={styles.bar}>
          <label className={styles.attach} title={`Adjuntar imágenes o PDF (hasta ${MAX_ATTACHMENTS})`}>
            <Paperclip aria-hidden="true" size={18} />
            <span>{fileCount > 0 ? (fileCount === 1 ? "1 adjunto" : `${fileCount} adjuntos`) : "Adjuntar"}</span>
            <input
              name="adjuntos"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className={styles.srOnly}
              onChange={(event) => setFileCount(event.target.files?.length ?? 0)}
            />
          </label>
          {orders.length > 0 && (
            <>
              <label className={styles.srOnly} htmlFor={`${idPrefix}-pedido`}>
                Sobre el pedido (opcional)
              </label>
              <select id={`${idPrefix}-pedido`} name="pedidoId" defaultValue={initialOrderId ?? ""} className={styles.orderSelect}>
                <option value="">Sin pedido</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    Pedido #{order.numero}
                  </option>
                ))}
              </select>
            </>
          )}
          <button type="submit" disabled={pending} className={styles.send} aria-label={pending ? "Enviando" : "Enviar mensaje"}>
            <Send aria-hidden="true" size={18} />
            <span className={styles.sendLabel}>{pending ? "Enviando…" : "Enviar"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
