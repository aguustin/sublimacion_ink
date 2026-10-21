import styles from "./exclusions.module.css";

/** Carga inicial: la estructura de la lista mientras llegan las fechas. */
export default function Loading() {
  return (
    <main className={styles.page} aria-busy="true">
      <p className={styles.eyebrow}>Calendario de la ventana de 48 h</p>
      <h1 className={styles.title}>Fechas excluidas</h1>
      <p className={styles.lead} role="status">
        Cargando las fechas…
      </p>
      <div style={{ marginTop: "2rem" }} aria-hidden="true">
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    </main>
  );
}
