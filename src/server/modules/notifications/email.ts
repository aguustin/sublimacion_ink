import { getConfig } from "@/server/shared/config";
import { logger } from "@/server/shared/logger";

export type Email = {
  to: string;
  subject: string;
  text: string;
};

export type EmailSender = {
  send(email: Email): Promise<void>;
};

/** Desarrollo local: el correo se escribe en el log para poder abrir los enlaces. */
const consoleSender: EmailSender = {
  async send(email) {
    logger.info({ correo: email }, "correo (proveedor de consola, solo local)");
  },
};

const sentEmails: Email[] = [];

/** Pruebas: guarda los correos en memoria. */
const memorySender: EmailSender = {
  async send(email) {
    sentEmails.push(email);
  },
};

/** Correos enviados con el proveedor `memoria`, para las pruebas. */
export function getSentEmails(): readonly Email[] {
  return sentEmails;
}

export function clearSentEmails(): void {
  sentEmails.length = 0;
}

export function getEmailSender(): EmailSender {
  return getConfig().EMAIL_PROVIDER === "memoria" ? memorySender : consoleSender;
}
