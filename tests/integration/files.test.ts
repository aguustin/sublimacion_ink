import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as attachRoute } from "@/app/api/admin/products/[id]/images/route";
import { POST as register } from "@/app/api/auth/register/route";
import { DELETE as deleteRoute } from "@/app/api/files/[id]/route";
import { GET as urlRoute } from "@/app/api/files/[id]/url/route";
import { POST as uploadRoute } from "@/app/api/files/route";
import { createCategory, createProduct, createVariant } from "@/server/modules/catalog/catalog-admin.service";
import { getProductBySlug } from "@/server/modules/catalog/catalog.service";
import { productImageUrls } from "@/server/modules/catalog/product-images.service";
import { uploadFile } from "@/server/modules/files/file.service";
import { clearMemoryObjects, getMemoryObjects, memoryStorage, type ObjectStorage } from "@/server/modules/files/storage";
import type { Db } from "@/server/shared/db";
import { getDb } from "@/server/shared/db";
import { APP_URL, apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

const db = () => getDb();

type Account = { id: string; cookie: string; rol: "CLIENTE" | "ADMIN" };

async function account(email: string, admin = false): Promise<Account> {
  const response = await register(apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1" } }));
  const { usuario } = await response.json();
  if (admin) await db().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response), rol: admin ? "ADMIN" : "CLIENTE" };
}

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part)));

/** Contenido mínimo con la firma real de cada tipo admitido (D-08). */
const SAMPLES = {
  "foto.jpg": { type: "image/jpeg", body: bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF resto") },
  "logo.png": { type: "image/png", body: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "IHDR resto") },
  "fondo.webp": { type: "image/webp", body: bytes("RIFF", [0x10, 0, 0, 0], "WEBPVP8 resto") },
  "diseño final.pdf": { type: "application/pdf", body: bytes("%PDF-1.7\n resto") },
} as const;

function upload(user: Account, name: string, body: Uint8Array, contexto: string, declaredType = "image/jpeg") {
  const form = new FormData();
  form.set("archivo", new File([body], name, { type: declaredType }));
  form.set("contexto", contexto);
  return uploadRoute(new Request(`${APP_URL}/api/files`, { method: "POST", headers: { origin: APP_URL, cookie: user.cookie }, body: form }));
}

/** Almacenamiento que cuenta las llamadas: permite comprobar qué no llegó a ejecutarse. */
function spyStorage(overrides: Partial<ObjectStorage> = {}) {
  const calls = { put: 0, delete: 0, signedGetUrl: 0 };
  const storage: ObjectStorage = {
    put: (...args) => (calls.put++, (overrides.put ?? memoryStorage.put)(...args)),
    delete: (...args) => (calls.delete++, (overrides.delete ?? memoryStorage.delete)(...args)),
    signedGetUrl: (...args) => (calls.signedGetUrl++, memoryStorage.signedGetUrl(...args)),
  };
  return { storage, calls };
}

const sessionUser = (user: Account) =>
  ({ id: user.id, rol: user.rol, email: "x@ejemplo.com", nombre: "Persona", telefono: null, emailVerificado: false }) as never;
const urlOf = (user: Account, id: string) => urlRoute(apiRequest(`/api/files/${id}/url`, { method: "GET", cookie: user.cookie }), params({ id }));

let admin: Account;
let ana: Account;

beforeEach(async () => {
  await resetDatabase();
  clearMemoryObjects();
  admin = await account("admin@tienda.ejemplo", true);
  ana = await account("ana@ejemplo.com");
});
afterAll(async () => {
  await db().$disconnect();
});

describe("subida de archivos (16.1, D-08)", () => {
  it("acepta JPG, PNG, WEBP y PDF por su contenido; guarda los metadatos y una clave generada por el servidor", async () => {
    for (const [name, { type, body }] of Object.entries(SAMPLES)) {
      // El tipo declarado por el cliente se ignora: se manda siempre uno falso.
      const response = await upload(ana, name, body, "REFERENCIA", "text/plain");
      expect(response.status).toBe(201);
      const { archivo } = await response.json();
      expect(archivo).toMatchObject({ nombreOriginal: name, tipo: type, tamanoBytes: body.length, contexto: "REFERENCIA" });
      expect(archivo).not.toHaveProperty("claveObjeto");

      const stored = await db().archivo.findUniqueOrThrow({ where: { id: archivo.id } });
      expect(stored).toMatchObject({ propietarioClienteId: ana.id, subidoPorId: ana.id, estado: "ACTIVO", tipoMimeDetectado: type });
      expect(stored.hashSha256).toBe(createHash("sha256").update(body).digest("hex"));
      expect(stored.claveObjeto).toMatch(/^referencia\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/);
      expect(getMemoryObjects().get(stored.claveObjeto)?.contentType).toBe(type);
    }
  });

  it("rechaza HTML, SVG o ejecutables con extensión permitida, sin guardar nada (T-44)", async () => {
    const disguised = [
      ["foto.jpg", bytes("<!DOCTYPE html><script>alert(1)</script>")],
      ["logo.png", bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
      ["diseño.pdf", bytes("MZ", [0x90, 0x00], "ejecutable")],
    ] as const;
    for (const [name, body] of disguised) {
      expect(await (await upload(ana, name, body, "REFERENCIA")).json()).toMatchObject({ codigo: "TIPO_NO_PERMITIDO" });
    }
    expect(await db().archivo.count()).toBe(0);
    expect(getMemoryObjects().size).toBe(0);
  });

  it("rechaza un archivo que supera el límite antes de llegar al almacenamiento (T-45)", async () => {
    const { storage, calls } = spyStorage();
    const file = new File([SAMPLES["foto.jpg"].body], "grande.jpg");
    await expect(uploadFile(sessionUser(ana), { file, contexto: "REFERENCIA" }, { storage, maxBytes: 5 })).rejects.toMatchObject({
      code: "ARCHIVO_DEMASIADO_GRANDE",
      status: 413,
    });
    expect(calls.put).toBe(0);

    // Por el endpoint, un cuerpo declarado más grande que el máximo se rechaza sin leerlo.
    const response = await uploadRoute(
      new Request(`${APP_URL}/api/files`, {
        method: "POST",
        headers: {
          origin: APP_URL,
          cookie: ana.cookie,
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(500 * 1024 * 1024),
        },
        body: "--x--",
      }),
    );
    expect(response.status).toBe(413);
    expect(await db().archivo.count()).toBe(0);
  });

  it("cada rol sube solo en sus contextos", async () => {
    expect((await upload(ana, "foto.jpg", SAMPLES["foto.jpg"].body, "PRODUCTO")).status).toBe(403);
    expect((await upload(admin, "foto.jpg", SAMPLES["foto.jpg"].body, "PRODUCTO")).status).toBe(201);
    expect((await upload(ana, "foto.jpg", SAMPLES["foto.jpg"].body, "INVENTADO")).status).toBe(422);
  });
});

describe("descarga con URL firmada (16.1)", () => {
  it("otro cliente recibe 404 sin que se firme ninguna URL; el dueño y el admin la obtienen (T-41, CA-14)", async () => {
    const { archivo } = await (await upload(ana, "foto.jpg", SAMPLES["foto.jpg"].body, "REFERENCIA")).json();
    const bruno = await account("bruno@ejemplo.com");

    const { storage, calls } = spyStorage();
    const { getFileUrl } = await import("@/server/modules/files/file.service");
    await expect(getFileUrl(sessionUser(bruno), archivo.id, { storage })).rejects.toMatchObject({ status: 404 });
    expect(calls.signedGetUrl).toBe(0);
    expect((await urlOf(bruno, archivo.id)).status).toBe(404);

    for (const user of [ana, admin]) {
      const response = await urlOf(user, archivo.id);
      expect(response.status).toBe(200);
      expect((await response.json()).url).toMatch(/^memoria:\/\/referencia\//);
    }
  });

  it("un archivo dado de baja deja de ser accesible, y el objeto se conserva (sin borrado físico)", async () => {
    const { archivo } = await (await upload(ana, "foto.jpg", SAMPLES["foto.jpg"].body, "REFERENCIA")).json();
    const bruno = await account("bruno@ejemplo.com");
    expect(
      (await deleteRoute(apiRequest(`/api/files/${archivo.id}`, { method: "DELETE", cookie: bruno.cookie }), params({ id: archivo.id }))).status,
    ).toBe(404);

    expect(
      (await deleteRoute(apiRequest(`/api/files/${archivo.id}`, { method: "DELETE", cookie: ana.cookie }), params({ id: archivo.id }))).status,
    ).toBe(204);
    expect(await db().archivo.findUniqueOrThrow({ where: { id: archivo.id } })).toMatchObject({ estado: "ELIMINADO", eliminadoPorId: ana.id });
    expect((await urlOf(ana, archivo.id)).status).toBe(404);
    expect(getMemoryObjects().size).toBe(1);
  });
});

describe("consistencia entre el objeto y los metadatos", () => {
  it("si el almacenamiento falla, no queda registro", async () => {
    const { storage } = spyStorage({ put: async () => Promise.reject(new Error("almacenamiento caído")) });
    const file = new File([SAMPLES["foto.jpg"].body], "foto.jpg");
    await expect(uploadFile(sessionUser(ana), { file, contexto: "REFERENCIA" }, { storage })).rejects.toMatchObject({
      code: "ALMACENAMIENTO_NO_DISPONIBLE",
      status: 503,
    });
    expect(await db().archivo.count()).toBe(0);
  });

  it("si fallan los metadatos, se borra el objeto ya guardado (compensación)", async () => {
    const { storage, calls } = spyStorage();
    const failingDb = new Proxy(db(), {
      get: (target, property) => (property === "$transaction" ? () => Promise.reject(new Error("base caída")) : Reflect.get(target, property)),
    }) as Db;
    const file = new File([SAMPLES["foto.jpg"].body], "foto.jpg");

    await expect(uploadFile(sessionUser(ana), { file, contexto: "REFERENCIA" }, { db: failingDb, storage })).rejects.toThrow("base caída");
    expect(calls.put).toBe(1);
    expect(calls.delete).toBe(1);
    expect(getMemoryObjects().size).toBe(0);
    expect(await db().archivo.count()).toBe(0);
  });
});

describe("imágenes de productos (RF-07)", () => {
  it("el admin sube y asocia una imagen; el catálogo la muestra con URL firmada; un PDF no se asocia", async () => {
    const actor = { id: admin.id };
    const category = await createCategory(actor, { nombre: "Tazas" });
    const product = await createProduct(actor, { nombre: "Taza", categoriaId: category.id, tipo: "ESTANDAR" });
    await createVariant(actor, product.id, { precioCentavos: 150000 });
    const attach = (archivoId: string) =>
      attachRoute(apiRequest(`/api/admin/products/${product.id}/images`, { cookie: admin.cookie, body: { archivoId } }), params({ id: product.id }));

    const image = (await (await upload(admin, "taza.png", SAMPLES["logo.png"].body, "PRODUCTO")).json()).archivo;
    expect((await attach(image.id)).status).toBe(201);
    expect((await attach(image.id)).status).toBe(409);
    const pdf = (await (await upload(admin, "ficha.pdf", SAMPLES["diseño final.pdf"].body, "PRODUCTO")).json()).archivo;
    expect((await attach(pdf.id)).status).toBe(422);

    const detail = await getProductBySlug(product.slug);
    expect(detail.imagenIds).toEqual([image.id]);
    expect((await productImageUrls(detail.imagenIds)).get(image.id)).toMatch(/^memoria:\/\/producto\//);
  });
});
