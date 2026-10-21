import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Email, EmailSender } from "@/server/modules/notifications/email";
import { dispatchOutbox, OUTBOX_MAX_ATTEMPTS } from "@/server/modules/notifications/outbox.service";
import { getDb } from "@/server/shared/db";
import { resetDatabase } from "./helpers";

const db = () => getDb();

/** Remitente de prueba: guarda lo enviado y puede fallar a pedido. */
function fakeSender({ fail = false, delayMs = 0 } = {}) {
  const sent: Email[] = [];
  const sender: EmailSender = {
    async send(email) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (fail) throw new Error("proveedor caído");
      sent.push(email);
    },
  };
  return { sender, sent };
}

const enqueue = (destinatario = "ana@ejemplo.com") =>
  db().salidaNotificacion.create({ data: { tipo: "PRUEBA", destinatario, asunto: "Asunto", cuerpo: "Cuerpo" } });

beforeEach(resetDatabase);
afterAll(async () => {
  await db().$disconnect();
});

describe("envío del outbox (16.3, INC-10.1b)", () => {
  it("envía los pendientes y los marca enviados; una segunda ejecución no los repite", async () => {
    const queued = await enqueue();
    const { sender, sent } = fakeSender();

    expect(await dispatchOutbox(db(), sender)).toMatchObject({ revisados: 1, enviados: 1 });
    expect(await dispatchOutbox(db(), sender)).toMatchObject({ revisados: 0 });
    expect(sent).toEqual([{ to: "ana@ejemplo.com", subject: "Asunto", text: "Cuerpo" }]);
    expect(await db().salidaNotificacion.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ estado: "ENVIADA", intentos: 1 });
  });

  it("dos ejecuciones simultáneas envían cada correo una sola vez", async () => {
    await Promise.all([enqueue("a@ejemplo.com"), enqueue("b@ejemplo.com"), enqueue("c@ejemplo.com")]);
    const { sender, sent } = fakeSender({ delayMs: 50 });

    await Promise.all([dispatchOutbox(db(), sender), dispatchOutbox(db(), sender)]);

    expect(sent.map((email) => email.to).sort()).toEqual(["a@ejemplo.com", "b@ejemplo.com", "c@ejemplo.com"]);
    expect(await db().salidaNotificacion.count({ where: { estado: "ENVIADA" } })).toBe(3);
  });

  it("si el correo falla, lo reprograma con espera creciente y, tras el último intento, queda fallido (T-83)", async () => {
    const queued = await enqueue();
    const { sender } = fakeSender({ fail: true });

    expect(await dispatchOutbox(db(), sender)).toMatchObject({ reintentos: 1 });
    const first = await db().salidaNotificacion.findUniqueOrThrow({ where: { id: queued.id } });
    expect(first).toMatchObject({ estado: "PENDIENTE", intentos: 1, error: "proveedor caído" });
    expect(first.proximoIntentoEn.getTime() - Date.now()).toBeGreaterThan(50_000);
    // Antes de que llegue el próximo intento, no se toca.
    expect(await dispatchOutbox(db(), sender)).toMatchObject({ revisados: 0 });

    for (let attempt = 2; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      await db().salidaNotificacion.update({ where: { id: queued.id }, data: { proximoIntentoEn: new Date(Date.now() - 1000) } });
      await dispatchOutbox(db(), sender);
    }
    expect(await db().salidaNotificacion.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({
      estado: "FALLIDA",
      intentos: OUTBOX_MAX_ATTEMPTS,
    });

    // Ya fallido, el proceso no lo vuelve a tomar.
    const { sender: working, sent } = fakeSender();
    await dispatchOutbox(db(), working);
    expect(sent).toHaveLength(0);
  });
});
