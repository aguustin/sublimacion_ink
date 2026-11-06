import { ArrowRight, Mail, MessageSquare, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getStoreContact } from "@/server/modules/store-settings/store-settings.service";
import styles from "./contact.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Contacto · Sublimaciones", description: "Cómo comunicarte con la tienda." };

/** Contacto (RF-49, rediseño v1.38): los canales que cargó la tienda y, siempre, el chat de la cuenta. */
export default async function ContactPage() {
  const { emailContacto, telefonoContacto } = await getStoreContact();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className="ink-eyebrow">Contacto</span>
        <h1>Hablemos</h1>
        <p>¿Tenés una consulta sobre un producto, un pedido o un diseño? Escribinos por el canal que te quede más cómodo.</p>
      </header>

      <ul className={styles.channels}>
        {emailContacto && (
          <li>
            <a href={`mailto:${emailContacto}`} className={styles.channel}>
              <span className={styles.icon}>
                <Mail aria-hidden="true" size={22} />
              </span>
              <span className={styles.label}>Email</span>
              <span className={styles.value}>{emailContacto}</span>
            </a>
          </li>
        )}
        {telefonoContacto && (
          <li>
            <a href={`tel:${telefonoContacto.replace(/[\s-]/g, "")}`} className={styles.channel}>
              <span className={styles.icon}>
                <Phone aria-hidden="true" size={22} />
              </span>
              <span className={styles.label}>Teléfono</span>
              <span className={styles.value}>{telefonoContacto}</span>
            </a>
          </li>
        )}
        <li>
          <Link href="/mensajes" className={`${styles.channel} ${styles.chat}`}>
            <span className={styles.icon}>
              <MessageSquare aria-hidden="true" size={22} />
            </span>
            <span className={styles.label}>Chat con la tienda</span>
            <span className={styles.value}>
              Desde tu cuenta, con tus pedidos a mano
              <ArrowRight aria-hidden="true" size={18} />
            </span>
          </Link>
        </li>
      </ul>
    </main>
  );
}
