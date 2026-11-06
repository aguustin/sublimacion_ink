import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as storeMessagesGet, POST as storeMessagesPost } from "@/app/api/admin/conversations/[clienteId]/messages/route";
import { POST as hideRoute } from "@/app/api/admin/messages/[id]/hide/route";
import { POST as register } from "@/app/api/auth/register/route";
import { GET as clientMessagesGet, POST as clientMessagesPost } from "@/app/api/conversation/messages/route";
import { POST as clientReadRoute } from "@/app/api/conversation/read/route";
import { GET as fileUrlRoute } from "@/app/api/files/[id]/url/route";
import { POST as uploadRoute } from "@/app/api/files/route";
import { unreadForClient } from "@/server/modules/chat/chat.service";
import { clearMemoryObjects, getMemoryObjects } from "@/server/modules/files/storage";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, createTestOrder, params, resetDatabase, sessionCookieFrom } from "./helpers";

// INC-13 e INC-07: solo lo que se puede romper. Pertenencia del pedido y de los adjuntos, acceso a
// los adjuntos de otra conversación, primer mensaje simultáneo, aviso único por ráfaga y miniaturas.

const db = () => getDb();
type Account = { id: string; cookie: string };

async function account(email: string, admin = false): Promise<Account> {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1", telefono: "1155551234" } }),
  );
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

async function upload(user: Account, bytes: Uint8Array<ArrayBuffer>, name: string, type: string, contexto = "CHAT") {
  const form = new FormData();
  form.set("archivo", new File([bytes], name, { type }));
  form.set("contexto", contexto);
  const response = await uploadRoute(
    new Request(`${APP_URL}/api/files`, { method: "POST", headers: { origin: APP_URL, cookie: user.cookie }, body: form }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).archivo.id as string;
}

const pdf = () => new TextEncoder().encode("%PDF-1.7\n adjunto") as Uint8Array<ArrayBuffer>;
const png = async (width: number, height: number) =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#f5d627" } })
      .png()
      .toBuffer(),
  ) as Uint8Array<ArrayBuffer>;

const clientSend = (user: Account, body: object) => clientMessagesPost(apiRequest("/api/conversation/messages", { cookie: user.cookie, body }));
const storeSend = (admin: Account, clienteId: string, body: object) =>
  storeMessagesPost(apiRequest(`/api/admin/conversations/${clienteId}/messages`, { cookie: admin.cookie, body }), params({ clienteId }));
const fileUrl = (user: Account, id: string, query = "") =>
  fileUrlRoute(apiRequest(`/api/files/${id}/url${query}`, { method: "GET", cookie: user.cookie }), params({ id }));

let admin: Account;
let ana: Account;
let beto: Account;

beforeEach(async () => {
  await resetDatabase();
  clearMemoryObjects();
  admin = await account("admin@ejemplo.com", true);
  ana = await account("ana@ejemplo.com");
  beto = await account("beto@ejemplo.com");
});

afterAll(() => resetDatabase());

describe("chat: pertenencia y acceso", () => {
  it("rechaza el pedido de otro cliente y el adjunto de otra persona o ya usado", async () => {
    const otherOrder = await createTestOrder();
    expect((await clientSend(ana, { texto: "Hola", pedidoId: otherOrder })).status).toBe(404);

    const betoFile = await upload(beto, pdf(), "beto.pdf", "application/pdf");
    expect((await clientSend(ana, { texto: "Mirá", archivoIds: [betoFile] })).status).toBe(404);

    const anaFile = await upload(ana, pdf(), "ana.pdf", "application/pdf");
    expect((await clientSend(ana, { texto: "Mirá", archivoIds: [anaFile] })).status).toBe(201);
    expect((await clientSend(ana, { texto: "Otra vez", archivoIds: [anaFile] })).status).toBe(404);
  });

  it("el adjunto de la tienda lo ve el cliente de esa conversación y nadie más", async () => {
    const file = await upload(admin, pdf(), "presupuesto.pdf", "application/pdf");
    expect((await storeSend(admin, ana.id, { texto: "Te paso el presupuesto", archivoIds: [file] })).status).toBe(201);
    expect((await fileUrl(ana, file)).status).toBe(200);
    expect((await fileUrl(beto, file)).status).toBe(404);
  });
});

describe("chat: conversación y avisos", () => {
  it("dos primeros mensajes simultáneos quedan en una sola conversación", async () => {
    const results = await Promise.all([clientSend(ana, { texto: "Hola" }), clientSend(ana, { texto: "¿Están?" })]);
    expect(results.map((response) => response.status)).toEqual([201, 201]);
    expect(await db().conversacion.count({ where: { clienteId: ana.id } })).toBe(1);
    expect(await db().mensaje.count()).toBe(2);
  });

  it("una ráfaga avisa una vez; leer reinicia el aviso", async () => {
    await clientSend(ana, { texto: "Uno" });
    await clientSend(ana, { texto: "Dos" });
    expect(await db().notificacion.count({ where: { tipo: "MENSAJE_CLIENTE" } })).toBe(1);

    await storeSend(admin, ana.id, { texto: "Respuesta" });
    await storeSend(admin, ana.id, { texto: "Otra" });
    expect(await unreadForClient(ana.id)).toBe(2);
    expect(await db().notificacion.count({ where: { tipo: "MENSAJE_TIENDA" } })).toBe(1);

    await clientReadRoute(apiRequest("/api/conversation/read", { cookie: ana.cookie }));
    expect(await unreadForClient(ana.id)).toBe(0);
    await storeSend(admin, ana.id, { texto: "¿Viste?" });
    expect(await db().notificacion.count({ where: { tipo: "MENSAJE_TIENDA" } })).toBe(2);

    const conversation = await storeMessagesGet(
      apiRequest(`/api/admin/conversations/${ana.id}/messages`, { method: "GET", cookie: admin.cookie }),
      params({ clienteId: ana.id }),
    );
    expect((await conversation.json()).mensajes).toHaveLength(5);
  });
});

describe("chat: mensajes ocultos", () => {
  it("el cliente no recibe el texto ni puede abrir el adjunto de un mensaje oculto; no se oculta dos veces", async () => {
    const file = await upload(admin, pdf(), "privado.pdf", "application/pdf");
    const sent = await storeSend(admin, ana.id, { texto: "Dato que no debía ir", archivoIds: [file] });
    const id = (await sent.json()).mensaje.id as string;
    const hide = () =>
      hideRoute(apiRequest(`/api/admin/messages/${id}/hide`, { cookie: admin.cookie, body: { motivo: "Error de la tienda" } }), params({ id }));
    expect((await hide()).status).toBe(200);
    expect((await (await hide()).json()).codigo).toBe("MENSAJE_YA_OCULTO");

    const { mensajes } = await (await clientMessagesGet(apiRequest("/api/conversation/messages", { method: "GET", cookie: ana.cookie }))).json();
    expect(mensajes[0]).toMatchObject({ texto: "", adjuntos: [], motivoOculto: null });
    expect(JSON.stringify(mensajes)).not.toContain("Dato que no debía ir");
    expect((await fileUrl(ana, file)).status).toBe(404);
    expect((await fileUrl(admin, file)).status).toBe(200);
  });
});

describe("miniaturas", () => {
  it("una imagen tiene miniatura WEBP chica; un PDF, no", async () => {
    const image = await upload(ana, await png(2000, 1000), "foto.png", "image/png");
    const archivo = await db().archivo.findUniqueOrThrow({ where: { id: image } });
    expect(archivo.claveMiniatura).not.toBeNull();
    const thumbnail = getMemoryObjects().get(archivo.claveMiniatura!)!;
    expect(thumbnail.contentType).toBe("image/webp");
    expect(await sharp(thumbnail.body).metadata()).toMatchObject({ format: "webp", width: 480, height: 240 });
    expect((await fileUrl(ana, image, "?miniatura=1")).status).toBe(200);

    const document = await upload(ana, pdf(), "doc.pdf", "application/pdf");
    expect((await db().archivo.findUniqueOrThrow({ where: { id: document } })).claveMiniatura).toBeNull();
  });

  it("una imagen enorme o dañada se guarda igual, sin miniatura", async () => {
    const huge = await upload(ana, await png(7200, 7200), "enorme.png", "image/png");
    expect((await db().archivo.findUniqueOrThrow({ where: { id: huge } })).claveMiniatura).toBeNull();

    // Firma de PNG válida, contenido roto.
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]) as Uint8Array<ArrayBuffer>;
    const damaged = await upload(ana, broken, "rota.png", "image/png");
    expect((await db().archivo.findUniqueOrThrow({ where: { id: damaged } })).claveMiniatura).toBeNull();
  });
});
