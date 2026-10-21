"use client";

import styles from "./exclusions.module.css";

/** Error al cargar la lista: se explica y se ofrece reintentar, sin mostrar datos parciales. */
export default function ExclusionsError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Calendario de la ventana de 48 h</p>
      <h1 className={styles.title}>Fechas excluidas</h1>
      <div className={styles.alert} role="alert" style={{ marginTop: "1.5rem" }}>
        <span aria-hidden="true">!</span>
        <span>No pudimos cargar las fechas excluidas. Revisá la conexión y probá de nuevo.</span>
      </div>
      <button type="button" className={`${styles.button} ${styles.primary}`} onClick={reset}>
        Reintentar
      </button>
    </main>
  );
}
