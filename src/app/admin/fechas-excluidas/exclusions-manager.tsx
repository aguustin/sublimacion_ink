"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { fieldErrors, postJson, sendJson, type ApiError } from "@/lib/api";
import styles from "./exclusions.module.css";

type Exclusion = { fecha: string; motivo: string; creadoPor: string | null; creadoEn: string };
type AffectedOrder = { pedidoId: string; numero: number; fechaDespacho: string; inicioAnterior: string; inicioNuevo: string; desdeAhora: boolean };
type Preview = { fecha: string; accion: "AGREGAR"; pedidos: AffectedOrder[] };
type Result = { recalculados: number; clientesNotificados: number };
type Toast = { id: number; kind: "success" | "info" | "error"; title: string; text: string };

// Las fechas excluidas son días completos ("AAAA-MM-DD"): se muestran tal cual, sin zona horaria.
const dayPart = (fecha: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-AR", { ...options, timeZone: "UTC" }).format(new Date(`${fecha}T00:00:00Z`));
const longDate = (fecha: string) => dayPart(fecha, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
// Los instantes (inicios de ventana, registro) se muestran en la hora de la tienda.
const instant = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Argentina/Buenos_Aires",
});
const registered = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" });

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function resultText({ recalculados, clientesNotificados }: Result) {
  if (recalculados === 0 && clientesNotificados === 0) return "No hubo pedidos afectados: no se recalculó ninguna ventana ni se avisó a clientes.";
  return `${plural(recalculados, "pedido recalculado", "pedidos recalculados")} · ${plural(clientesNotificados, "cliente avisado", "clientes avisados")}.`;
}

/** Trazo de marcador bajo el título. */
function Stroke() {
  return (
    <svg className={styles.stroke} viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M4 15c46-7 93-10 141-9 52 1 101 4 151-3l-1 9c-48 7-98 5-150 4-48-1-95 1-140 8Z" fill="currentColor" />
    </svg>
  );
}

/** Estado vacío: una hoja de calendario con una gota de tinta. */
function EmptyArt() {
  return (
    <svg className={styles.emptyArt} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <rect x="18" y="24" width="72" height="76" rx="14" fill="#fff" stroke="#1c1b1b" strokeWidth="4" />
      <path d="M18 46h72" stroke="#1c1b1b" strokeWidth="4" />
      <path d="M36 16v16M72 16v16" stroke="#1c1b1b" strokeWidth="4" strokeLinecap="round" />
      <path d="M38 64h18M38 78h30" stroke="#e5dcc8" strokeWidth="6" strokeLinecap="round" />
      <path d="M92 52c7 10 14 17 14 26a14 14 0 0 1-28 0c0-9 7-16 14-26Z" fill="#f5d627" stroke="#1c1b1b" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Modal sobre `<dialog>` nativo: atrapa el foco, bloquea el fondo y se cierra con Escape. Al cerrarse
 * devuelve el foco a `returnFocus`, un control coherente con el flujo.
 */
function Modal({
  open,
  onClose,
  returnFocus,
  labelledBy,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  labelledBy: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
      returnFocus.current?.focus();
    }
  }, [open, returnFocus]);
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        // Escape: el componente decide (no se cierra mientras se confirma).
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.dialogInner}>{children}</div>
    </dialog>
  );
}

export function ExclusionsManager({ exclusions }: { exclusions: Exclusion[] }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [fecha, setFecha] = useState("");
  const [motivo, setMotivo] = useState("");
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToastId = useRef(0);
  const busy = useRef(false); // evita dobles envíos aunque el estado todavía no se haya renderizado

  const addButton = useRef<HTMLButtonElement>(null);
  const emptyButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const focusAddAfterRefresh = useRef(false);

  useEffect(() => {
    if (focusAddAfterRefresh.current && addButton.current) {
      focusAddAfterRefresh.current = false;
      addButton.current.focus();
    }
  }, [exclusions]);

  // Ayuda de entrada; las reglas de verdad las valida el servidor.
  const localErrors = {
    fecha: fecha ? null : "Elegí la fecha que no va a contar.",
    motivo: motivo.trim().length >= 3 ? null : "Contá el motivo en al menos 3 caracteres.",
  };
  const serverFields = fieldErrors(formError);
  const fechaError = (touched && localErrors.fecha) || serverFields.fecha || null;
  const motivoError = (touched && localErrors.motivo) || serverFields.motivo || null;

  function toast(kind: Toast["kind"], title: string, text: string) {
    const id = (nextToastId.current += 1);
    setToasts((current) => [...current, { id, kind, title, text }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 8000);
  }

  function openForm(trigger: HTMLElement | null) {
    opener.current = trigger;
    setFecha("");
    setMotivo("");
    setTouched(false);
    setFormError(null);
    setFormOpen(true);
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (localErrors.fecha || localErrors.motivo || busy.current) return;
    busy.current = true;
    setPreviewing(true);
    const result = await postJson<Preview>("/api/admin/cancellation-window-exclusions/preview", { fecha, accion: "AGREGAR" });
    busy.current = false;
    setPreviewing(false);
    if (!result.ok) {
      setFormError(result.error);
      if (result.error.codigo === "FECHA_YA_EXCLUIDA") router.refresh();
      return;
    }
    setFormError(null);
    setConfirmError(null);
    setPreview(result.data);
  }

  async function confirm() {
    if (!preview || busy.current) return;
    busy.current = true;
    setConfirming(true);
    setConfirmError(null);
    const result = await postJson<Result>("/api/admin/cancellation-window-exclusions", { fecha: preview.fecha, motivo: motivo.trim() });
    busy.current = false;
    setConfirming(false);
    if (!result.ok) {
      // Se conservan el formulario y la vista previa para reintentar o volver.
      setConfirmError(
        result.error.codigo === "FECHA_YA_EXCLUIDA"
          ? "Otra persona ya excluyó esta fecha. Actualizamos la lista; no se hizo ningún cambio nuevo."
          : result.error.mensaje,
      );
      if (result.error.codigo === "FECHA_YA_EXCLUIDA") router.refresh();
      return;
    }
    const registeredDate = preview.fecha;
    opener.current = addButton.current;
    focusAddAfterRefresh.current = true;
    setPreview(null);
    setFormOpen(false);
    toast("success", `Excluimos el ${longDate(registeredDate)}`, `Motivo: ${motivo.trim()}. ${resultText(result.data)}`);
    router.refresh();
  }

  async function remove(exclusion: Exclusion) {
    if (busy.current) return;
    busy.current = true;
    setRemoving(exclusion.fecha);
    const result = await sendJson<Result>("DELETE", `/api/admin/cancellation-window-exclusions/${exclusion.fecha}`);
    busy.current = false;
    setRemoving(null);
    if (result.ok) {
      toast("success", `Quitamos el ${longDate(exclusion.fecha)}`, resultText(result.data));
      router.refresh();
    } else if (result.error.codigo === "FECHA_NO_EXCLUIDA") {
      toast("info", "Esa fecha ya no estaba excluida", "Otra persona la quitó antes. Actualizamos la lista para mostrar el estado real.");
      router.refresh();
    } else {
      toast("error", "No pudimos quitar la fecha", `${result.error.mensaje} La fecha sigue excluida.`);
    }
  }

  const affected = preview?.pedidos ?? [];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Calendario de la ventana de 48 h</p>
          <span className={styles.titleWrap}>
            <h1 className={styles.title}>
              Fechas excluidas
              <Stroke />
            </h1>
          </span>
          <p className={styles.lead}>
            Días completos que no cuentan para la ventana de cancelación con cargo. Al agregar o quitar una fecha recalculamos los pedidos afectados y
            avisamos a sus clientes.
          </p>
        </div>
        {exclusions.length > 0 && (
          <button ref={addButton} type="button" className={`${styles.button} ${styles.primary}`} onClick={(event) => openForm(event.currentTarget)}>
            Agregar fecha
          </button>
        )}
      </header>

      {exclusions.length === 0 ? (
        <section className={styles.empty} aria-labelledby="empty-title">
          <EmptyArt />
          <div>
            <h2 id="empty-title" className={styles.emptyTitle}>
              Todavía no hay fechas excluidas
            </h2>
            <p className={styles.emptyText}>
              Hoy la ventana son 48 horas corridas antes de cada fecha comprometida, incluidos fines de semana y feriados.
            </p>
            <button
              ref={emptyButton}
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={(event) => openForm(event.currentTarget)}
            >
              Agregar la primera fecha
            </button>
          </div>
        </section>
      ) : (
        <ul className={styles.list} aria-label="Fechas excluidas">
          {exclusions.map((exclusion) => {
            const isRemoving = removing === exclusion.fecha;
            return (
              <li key={exclusion.fecha} className={styles.row}>
                <div className={styles.day} aria-hidden="true">
                  <span className={styles.dayMonth}>{dayPart(exclusion.fecha, { month: "short" }).replace(".", "")}</span>
                  <span className={styles.dayNumber}>{dayPart(exclusion.fecha, { day: "numeric" })}</span>
                  <span className={styles.dayWeekday}>{dayPart(exclusion.fecha, { weekday: "short" }).replace(".", "")}</span>
                </div>
                <div className={styles.body}>
                  <p className={styles.reason}>{exclusion.motivo}</p>
                  <p className={styles.fullDate}>{longDate(exclusion.fecha)}</p>
                  <p className={styles.meta}>
                    Registrada por {exclusion.creadoPor ?? "un administrador"} · {registered.format(new Date(exclusion.creadoEn))}
                  </p>
                </div>
                <div className={styles.action}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.secondary}`}
                    onClick={() => remove(exclusion)}
                    disabled={removing !== null}
                    aria-busy={isRemoving}
                    aria-label={`Quitar el ${longDate(exclusion.fecha)}`}
                  >
                    {isRemoving ? "Quitando…" : "Quitar"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Paso 1: la fecha y el motivo */}
      <Modal open={formOpen} onClose={() => !confirming && setFormOpen(false)} returnFocus={opener} labelledBy="exclusion-form-title">
        <form onSubmit={review} noValidate className={styles.dialogInner}>
          <div className={styles.dialogHeader}>
            <p className={styles.step}>Paso 1 de 2</p>
            <h2 id="exclusion-form-title" className={styles.dialogTitle}>
              Agregar una fecha excluida
            </h2>
          </div>
          <div className={styles.dialogBody}>
            {formError && !serverFields.fecha && !serverFields.motivo && (
              <p className={styles.alert} role="alert">
                <span aria-hidden="true">!</span>
                <span>{formError.mensaje}</span>
              </p>
            )}
            <div className={styles.field}>
              <label htmlFor="exclusion-date" className={styles.label}>
                Fecha
              </label>
              <span id="exclusion-date-hint" className={styles.hint}>
                El día completo deja de contar para la ventana de 48 h. No cambia las reservas ni los feriados.
              </span>
              <input
                id="exclusion-date"
                data-autofocus
                type="date"
                className={styles.input}
                value={fecha}
                onChange={(event) => setFecha(event.target.value)}
                aria-invalid={Boolean(fechaError)}
                aria-describedby={`exclusion-date-hint${fechaError ? " exclusion-date-error" : ""}`}
                required
              />
              {fechaError && (
                <p id="exclusion-date-error" className={styles.fieldError}>
                  <span aria-hidden="true">!</span> {fechaError}
                </p>
              )}
            </div>
            <div className={styles.field}>
              <label htmlFor="exclusion-reason" className={styles.label}>
                Motivo
              </label>
              <span id="exclusion-reason-hint" className={styles.hint}>
                Lo ven los administradores. Por ejemplo: «Cierre por inventario».
              </span>
              <textarea
                id="exclusion-reason"
                className={styles.input}
                value={motivo}
                maxLength={300}
                onChange={(event) => setMotivo(event.target.value)}
                aria-invalid={Boolean(motivoError)}
                aria-describedby={`exclusion-reason-hint${motivoError ? " exclusion-reason-error" : ""}`}
                required
              />
              {motivoError && (
                <p id="exclusion-reason-error" className={styles.fieldError}>
                  <span aria-hidden="true">!</span> {motivoError}
                </p>
              )}
            </div>
          </div>
          <div className={styles.dialogFooter}>
            <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={() => setFormOpen(false)}>
              Cancelar
            </button>
            <button ref={reviewButton} type="submit" className={`${styles.button} ${styles.primary}`} disabled={previewing} aria-busy={previewing}>
              {previewing ? "Revisando…" : "Revisar impacto"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Paso 2: impacto real según el servidor, superpuesto al formulario */}
      <Modal
        open={preview !== null}
        onClose={() => !confirming && setPreview(null)}
        returnFocus={reviewButton}
        labelledBy="exclusion-preview-title"
        wide
      >
        {preview && (
          <>
            <div className={styles.dialogHeader}>
              <p className={styles.step}>Paso 2 de 2</p>
              <h2 id="exclusion-preview-title" className={styles.dialogTitle} tabIndex={-1} data-autofocus>
                Revisá el impacto
              </h2>
              <div className={styles.summary}>
                <div>
                  <div className={styles.summaryDate}>{longDate(preview.fecha)}</div>
                  <p className={styles.summaryReason}>Motivo: {motivo.trim()}</p>
                </div>
                <span className={`${styles.count} ${affected.length === 0 ? styles.countNone : ""}`}>
                  {affected.length === 0 ? "Ningún pedido afectado" : plural(affected.length, "pedido afectado", "pedidos afectados")}
                </span>
              </div>
            </div>
            <div className={styles.dialogBody}>
              {confirmError && (
                <p className={styles.alert} role="alert">
                  <span aria-hidden="true">!</span>
                  <span>{confirmError}</span>
                </p>
              )}
              {affected.length === 0 ? (
                <div className={styles.nothing}>
                  <strong>Este cambio no modifica ninguna ventana.</strong>
                  No se avisará a ningún cliente. La fecha queda registrada para las fechas comprometidas que se confirmen después.
                </div>
              ) : (
                <ul className={styles.orders}>
                  {affected.map((order) => (
                    <li key={order.pedidoId} className={styles.order}>
                      <p className={styles.orderTitle}>
                        <Link href={`/admin/pedidos/${order.pedidoId}`} target="_blank" rel="noopener">
                          Pedido #{order.numero}
                        </Link>
                      </p>
                      <dl className={styles.orderFacts}>
                        <div>
                          <dt>Fecha comprometida</dt>
                          <dd>{instant.format(new Date(order.fechaDespacho))}</dd>
                        </div>
                        <div>
                          <dt>Inicio actual</dt>
                          <dd className={styles.previous}>{instant.format(new Date(order.inicioAnterior))}</dd>
                        </div>
                        <div>
                          <dt>Nuevo inicio</dt>
                          <dd>
                            <span className={styles.newStart}>{order.desdeAhora ? "Desde ahora" : instant.format(new Date(order.inicioNuevo))}</span>
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.note}>
                La vista previa refleja el estado de este momento. Si algo cambia antes de confirmar, el resultado final puede ser distinto: te
                mostramos lo que realmente se aplicó.
              </p>
            </div>
            <div className={styles.dialogFooter}>
              <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={() => setPreview(null)} disabled={confirming}>
                Volver
              </button>
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={confirm} disabled={confirming} aria-busy={confirming}>
                {confirming ? "Confirmando…" : affected.length === 0 ? "Confirmar la fecha" : "Confirmar y avisar"}
              </button>
            </div>
          </>
        )}
      </Modal>

      <div className={styles.toasts}>
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`${styles.toast} ${item.kind === "info" ? styles.toastInfo : ""} ${item.kind === "error" ? styles.toastError : ""}`}
            role={item.kind === "error" ? "alert" : "status"}
          >
            <div className={styles.toastBody}>
              <p className={styles.toastTitle}>
                {item.kind === "success" ? "Listo: " : item.kind === "error" ? "Error: " : "Aviso: "}
                {item.title}
              </p>
              <p className={styles.toastText}>{item.text}</p>
            </div>
            <button
              type="button"
              className={styles.toastClose}
              aria-label="Cerrar aviso"
              onClick={() => setToasts((current) => current.filter((toastItem) => toastItem.id !== item.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
