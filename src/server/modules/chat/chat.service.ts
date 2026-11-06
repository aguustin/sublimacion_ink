import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/modules/audit/audit.service";
import type { SessionUser } from "@/server/modules/auth/session.service";
import { enqueueNotification } from "@/server/modules/notifications/notification.service";
import { getDb, type Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { consumeRateLimit } from "@/server/shared/rate-limit";

type Tx = Prisma.TransactionClient;

// Chat (RF-29, F-07, 16.2): una conversación por cliente, mensajes que no se editan ni se borran,
// adjuntos con el sistema de archivos (contexto CHAT) y polling desde la interfaz, sin WebSockets.

/** Mensajes que devuelve cada lectura: los últimos, suficientes para una conversación de la tienda. */
const MESSAGES_LIMIT = 200;
const MAX_ATTACHMENTS = 5;
/** Contra el abuso del cliente: un mensaje por cada pocos segundos alcanza para conversar. */
const CLIENT_RATE_LIMIT = { limit: 30, windowSeconds: 10 * 60 };

const messageSchema = z.strictObject({
  texto: z.string("Escribí un mensaje.").trim().min(1, "Escribí un mensaje.").max(2000, "El mensaje admite hasta 2000 caracteres."),
  pedidoId: z.preprocess((value) => (value === "" || value === null ? undefined : value), z.uuid("El pedido no es válido.").optional()),
  archivoIds: z
    .array(z.uuid("Un adjunto no es válido."))
    .max(MAX_ATTACHMENTS, `Podés adjuntar hasta ${MAX_ATTACHMENTS} archivos por mensaje.`)
    .refine((ids) => new Set(ids).size === ids.length, "Hay un adjunto repetido.")
    .default([]),
});

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

const messageSelect = {
  id: true,
  deTienda: true,
  texto: true,
  creadoEn: true,
  leidoEn: true,
  ocultoEn: true,
  motivoOculto: true,
  pedido: { select: { id: true, numero: true } },
  adjuntos: { orderBy: { orden: "asc" }, select: { archivo: { select: { id: true, nombreOriginal: true, tipoMimeDetectado: true } } } },
} satisfies Prisma.MensajeSelect;

export type ChatMessage = Prisma.MensajeGetPayload<{ select: typeof messageSelect }>;

/**
 * Lo que ve el cliente de un mensaje (16.2): de uno oculto por la tienda, solo que existió; ni el
 * texto, ni los adjuntos, ni el pedido, ni el motivo, que es interno.
 */
function forClient(message: ChatMessage): ChatMessage {
  if (!message.ocultoEn) return { ...message, motivoOculto: null };
  return { ...message, texto: "", pedido: null, adjuntos: [], motivoOculto: null };
}

async function latestMessages(db: Db | Tx, conversacionId: string | undefined): Promise<ChatMessage[]> {
  if (!conversacionId) return [];
  const messages = await db.mensaje.findMany({
    where: { conversacionId },
    orderBy: { creadoEn: "desc" },
    take: MESSAGES_LIMIT,
    select: messageSelect,
  });
  return messages.reverse();
}

function assertClient(user: SessionUser) {
  if (user.rol !== "CLIENTE") throw new AppError("SOLO_CLIENTES", "El chat de la tienda es para los clientes.", 403);
}

/**
 * Valida y guarda un mensaje. El pedido tiene que ser del cliente de la conversación y cada adjunto,
 * un archivo de chat activo subido por quien escribe y todavía sin usar.
 */
async function createMessage(tx: Tx, clienteId: string, author: SessionUser, deTienda: boolean, input: unknown) {
  const data = messageSchema.parse(input);
  if (data.pedidoId) {
    const owned = await tx.pedido.count({ where: { id: data.pedidoId, clienteId } });
    if (!owned) throw new AppError("PEDIDO_NO_ENCONTRADO", "No encontramos ese pedido.", 404);
  }
  if (data.archivoIds.length > 0) {
    const files = await tx.archivo.count({
      where: { id: { in: data.archivoIds }, estado: "ACTIVO", contexto: "CHAT", subidoPorId: author.id, adjuntoMensaje: null },
    });
    if (files !== data.archivoIds.length) throw new AppError("ARCHIVO_NO_ENCONTRADO", "No encontramos alguno de los adjuntos.", 404);
  }

  // La conversación se crea con el primer mensaje, de cualquiera de los dos lados.
  const now = new Date();
  const conversation = await tx.conversacion.upsert({
    where: { clienteId },
    create: { clienteId, ultimoMensajeEn: now },
    update: { ultimoMensajeEn: now },
  });
  // ¿Ya había mensajes sin leer de este lado? Entonces la otra parte ya fue avisada.
  const pendingBefore = await tx.mensaje.count({ where: { conversacionId: conversation.id, deTienda, leidoEn: null } });
  const message = await tx.mensaje.create({
    data: {
      conversacionId: conversation.id,
      autorId: author.id,
      deTienda,
      texto: data.texto,
      pedidoId: data.pedidoId,
      adjuntos: { create: data.archivoIds.map((archivoId, orden) => ({ archivoId, orden })) },
    },
    select: messageSelect,
  });
  await recordAudit(tx, {
    actorId: author.id,
    accion: "MENSAJE_ENVIADO",
    entidad: "conversacion",
    entidadId: conversation.id,
    datos: { mensajeId: message.id, deTienda, pedidoId: data.pedidoId ?? null, adjuntos: data.archivoIds.length },
  });
  return { message, notify: pendingBefore === 0 };
}

/** Mensajes del cliente con la tienda. */
export async function getClientMessages(user: SessionUser, db: Db = getDb()) {
  assertClient(user);
  const conversation = await db.conversacion.findUnique({ where: { clienteId: user.id }, select: { id: true } });
  return (await latestMessages(db, conversation?.id)).map(forClient);
}

/**
 * El cliente escribe a la tienda. Se avisa a la administración solo con el primer mensaje sin leer
 * (confirmado en v1.36): una ráfaga de mensajes no manda un correo por cada uno.
 */
export async function sendClientMessage(user: SessionUser, input: unknown, db: Db = getDb()) {
  assertClient(user);
  await consumeRateLimit(db, `chat:cliente:${user.id}`, CLIENT_RATE_LIMIT);
  return db.$transaction(async (tx) => {
    const { message, notify } = await createMessage(tx, user.id, user, false, input);
    if (notify) {
      const admins = await tx.usuario.findMany({ where: { rol: "ADMIN" }, select: { id: true, email: true } });
      for (const admin of admins) {
        await enqueueNotification(tx, {
          usuarioId: admin.id,
          email: admin.email,
          tipo: "MENSAJE_CLIENTE",
          titulo: `Mensaje nuevo de ${user.nombre}`,
          mensaje: "Un cliente te escribió por el chat de la tienda. Respondelo desde el panel, en Mensajes.",
        });
      }
    }
    return message;
  });
}

/** El cliente leyó los mensajes de la tienda. */
export async function markReadByClient(user: SessionUser, db: Db = getDb()) {
  assertClient(user);
  const { count } = await db.mensaje.updateMany({
    where: { conversacion: { clienteId: user.id }, deTienda: true, leidoEn: null },
    data: { leidoEn: new Date() },
  });
  return { leidos: count };
}

/** Mensajes de la tienda que el cliente todavía no leyó (indicador de la cuenta). */
export function unreadForClient(clienteId: string, db: Db = getDb()) {
  return db.mensaje.count({ where: { conversacion: { clienteId }, deTienda: true, leidoEn: null, ocultoEn: null } });
}

async function findCustomer(db: Db | Tx, clienteId: string) {
  const customer = isUuid(clienteId)
    ? await db.usuario.findFirst({ where: { id: clienteId, rol: "CLIENTE" }, select: { id: true, nombre: true, email: true } })
    : null;
  if (!customer) throw new AppError("CLIENTE_NO_ENCONTRADO", "No encontramos ese cliente.", 404);
  return customer;
}

/** Conversación de un cliente vista por la tienda (por cliente: la tienda puede escribir primero). */
export async function getStoreConversation(clienteId: string, db: Db = getDb()) {
  const customer = await findCustomer(db, clienteId);
  const [conversation, pedidos] = await Promise.all([
    db.conversacion.findUnique({ where: { clienteId }, select: { id: true } }),
    // Para asociar la respuesta a un pedido del cliente.
    db.pedido.findMany({ where: { clienteId }, orderBy: { creadoEn: "desc" }, take: 100, select: { id: true, numero: true } }),
  ]);
  return { cliente: customer, pedidos, mensajes: await latestMessages(db, conversation?.id) };
}

/** La tienda responde. Se avisa al cliente con el primer mensaje sin leer, igual que en el otro sentido. */
export async function sendStoreMessage(admin: SessionUser, clienteId: string, input: unknown, db: Db = getDb()) {
  return db.$transaction(async (tx) => {
    const customer = await findCustomer(tx, clienteId);
    const { message, notify } = await createMessage(tx, customer.id, admin, true, input);
    if (notify) {
      await enqueueNotification(tx, {
        usuarioId: customer.id,
        email: customer.email,
        tipo: "MENSAJE_TIENDA",
        titulo: "Tenés un mensaje de la tienda",
        mensaje: "La tienda te respondió. Lo ves en Mi cuenta, en Mensajes.",
      });
    }
    return message;
  });
}

/** La tienda leyó los mensajes de ese cliente. */
export async function markReadByStore(clienteId: string, db: Db = getDb()) {
  await findCustomer(db, clienteId);
  const { count } = await db.mensaje.updateMany({
    where: { conversacion: { clienteId }, deTienda: false, leidoEn: null },
    data: { leidoEn: new Date() },
  });
  return { leidos: count };
}

/** Listado del panel: las conversaciones con actividad, la más reciente primero, con sus no leídos. */
export async function listConversations(db: Db = getDb()) {
  const conversations = await db.conversacion.findMany({
    where: { ultimoMensajeEn: { not: null } },
    orderBy: { ultimoMensajeEn: "desc" },
    select: {
      ultimoMensajeEn: true,
      cliente: { select: { id: true, nombre: true, email: true } },
      mensajes: { orderBy: { creadoEn: "desc" }, take: 1, select: { texto: true, deTienda: true, ocultoEn: true } },
      _count: { select: { mensajes: { where: { deTienda: false, leidoEn: null } } } },
    },
  });
  return conversations.map(({ cliente, ultimoMensajeEn, mensajes, _count }) => ({
    cliente,
    ultimoMensajeEn,
    ultimo: mensajes[0] ?? null,
    sinLeer: _count.mensajes,
  }));
}

/** Mensajes de clientes sin leer por la tienda (panel inicial, RF-45). */
export function unreadForStore(db: Db = getDb()) {
  return db.mensaje.count({ where: { deTienda: false, leidoEn: null } });
}

const hideSchema = z.strictObject({
  motivo: z.string("Indicá el motivo.").trim().min(1, "Indicá el motivo.").max(500),
});

/**
 * La tienda oculta un mensaje (16.2), de cualquiera de los dos lados, con motivo auditado. No se
 * borra: queda para la tienda con el motivo; el cliente ve solo que hubo un mensaje oculto.
 */
export async function hideMessage(admin: SessionUser, mensajeId: string, input: unknown, db: Db = getDb()) {
  const { motivo } = hideSchema.parse(input);
  return db.$transaction(async (tx) => {
    const message = isUuid(mensajeId) ? await tx.mensaje.findUnique({ where: { id: mensajeId }, select: { id: true, conversacionId: true } }) : null;
    if (!message) throw new AppError("MENSAJE_NO_ENCONTRADO", "No encontramos ese mensaje.", 404);
    const hidden = await tx.mensaje.updateMany({
      where: { id: message.id, ocultoEn: null },
      data: { ocultoEn: new Date(), ocultoPorId: admin.id, motivoOculto: motivo },
    });
    if (hidden.count === 0) throw new AppError("MENSAJE_YA_OCULTO", "Ese mensaje ya está oculto.", 409);
    await recordAudit(tx, {
      actorId: admin.id,
      accion: "MENSAJE_OCULTADO",
      entidad: "conversacion",
      entidadId: message.conversacionId,
      datos: { mensajeId: message.id, motivo },
    });
    return { ocultado: true };
  });
}
