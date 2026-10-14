import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createCategoryRoute } from "@/app/api/admin/categories/route";
import { PATCH as patchProduct } from "@/app/api/admin/products/[id]/route";
import { POST as createVariantRoute } from "@/app/api/admin/products/[id]/variants/route";
import { GET as listProductsRoute, POST as createProductRoute } from "@/app/api/admin/products/route";
import { PATCH as patchVariant } from "@/app/api/admin/variants/[id]/route";
import { POST as register } from "@/app/api/auth/register/route";
import { getDb } from "@/server/shared/db";
import { apiRequest, params, resetDatabase, sessionCookieFrom } from "./helpers";

async function account(email: string, admin: boolean) {
  const response = await register(
    apiRequest("/api/auth/register", { body: { nombre: "Persona", email, contrasena: "clave-segura-1" } }),
  );
  const { usuario } = await response.json();
  if (admin) await getDb().usuario.update({ where: { id: usuario.id }, data: { rol: "ADMIN" } });
  return { id: usuario.id as string, cookie: sessionCookieFrom(response) };
}

async function post<T>(handler: (request: Request, context?: never) => Promise<Response>, path: string, cookie: string, body: unknown) {
  const response = await handler(apiRequest(path, { cookie, body }));
  return { status: response.status, body: (await response.json()) as T };
}

let admin: { id: string; cookie: string };

async function setupProduct(tipo: "ESTANDAR" | "PERSONALIZABLE", nombre = "Taza Mágica") {
  const category = await post<{ categoria: { id: string } }>(createCategoryRoute, "/api/admin/categories", admin.cookie, { nombre: "Tazas" });
  const product = await post<{ producto: { id: string; slug: string } }>(createProductRoute, "/api/admin/products", admin.cookie, {
    nombre,
    categoriaId: category.body.categoria.id,
    tipo,
  });
  return product.body.producto;
}

const addVariant = (productId: string, body: unknown) =>
  createVariantRoute(apiRequest(`/api/admin/products/${productId}/variants`, { cookie: admin.cookie, body }), params({ id: productId }));

beforeEach(async () => {
  await resetDatabase();
  admin = await account("admin@tienda.ejemplo", true);
});
afterAll(async () => {
  await getDb().$disconnect();
});

describe("autorización (RF-07)", () => {
  it("los endpoints del catálogo administrativo exigen rol de administrador", async () => {
    const client = await account("ana@ejemplo.com", false);

    expect((await listProductsRoute(apiRequest("/api/admin/products", { method: "GET" }))).status).toBe(401);
    expect((await listProductsRoute(apiRequest("/api/admin/products", { method: "GET", cookie: client.cookie }))).status).toBe(403);
    expect((await createCategoryRoute(apiRequest("/api/admin/categories", { cookie: client.cookie, body: { nombre: "X" } }))).status).toBe(403);
  });
});

describe("productos", () => {
  it("genera un slug único y audita la creación", async () => {
    const first = await setupProduct("ESTANDAR");
    const category = await getDb().categoria.findFirstOrThrow();
    const second = await post<{ producto: { slug: string } }>(createProductRoute, "/api/admin/products", admin.cookie, {
      nombre: "Taza mágica",
      categoriaId: category.id,
      tipo: "ESTANDAR",
    });

    expect(first.slug).toBe("taza-magica");
    expect(second.body.producto.slug).toBe("taza-magica-2");
    expect(await getDb().eventoAuditoria.count({ where: { accion: "PRODUCTO_CREADO", actorId: admin.id } })).toBe(2);
  });

  it("no permite cambiar el tipo ni enviar campos desconocidos", async () => {
    const product = await setupProduct("ESTANDAR");
    const response = await patchProduct(
      apiRequest(`/api/admin/products/${product.id}`, { method: "PATCH", cookie: admin.cookie, body: { tipo: "PERSONALIZABLE" } }),
      params({ id: product.id }),
    );

    expect(response.status).toBe(422);
    expect((await getDb().producto.findUniqueOrThrow({ where: { id: product.id } })).tipo).toBe("ESTANDAR");
  });

  it("rechaza una categoría inexistente", async () => {
    const response = await post<{ codigo: string }>(createProductRoute, "/api/admin/products", admin.cookie, {
      nombre: "X",
      categoriaId: crypto.randomUUID(),
      tipo: "ESTANDAR",
    });
    expect(response.body.codigo).toBe("CATEGORIA_NO_ENCONTRADA");
  });
});

describe("variantes y precios (RN-26)", () => {
  it("un producto estándar exige precio; uno personalizable no lo admite", async () => {
    const standard = await setupProduct("ESTANDAR");
    const custom = await setupProduct("PERSONALIZABLE", "Remera personalizada");

    const noPrice = await addVariant(standard.id, { material: "Cerámica" });
    const withPrice = await addVariant(custom.id, { talle: "M", precioCentavos: 100000 });

    expect(noPrice.status).toBe(422);
    expect((await noPrice.json()).codigo).toBe("PRECIO_REQUERIDO");
    expect(withPrice.status).toBe(422);
    expect((await withPrice.json()).codigo).toBe("PRECIO_NO_PERMITIDO");
    expect((await addVariant(custom.id, { talle: "M" })).status).toBe(201);
  });

  it("valida el precio como centavos enteros y positivos", async () => {
    const product = await setupProduct("ESTANDAR");
    expect((await addVariant(product.id, { precioCentavos: 10.5 })).status).toBe(422);
    expect((await addVariant(product.id, { precioCentavos: 0 })).status).toBe(422);
  });

  it("genera el SKU si no se informa y rechaza uno repetido", async () => {
    const product = await setupProduct("ESTANDAR");
    const generated = await (await addVariant(product.id, { precioCentavos: 100000 })).json();
    const duplicate = await addVariant(product.id, { sku: generated.variante.sku, precioCentavos: 100000 });

    expect(generated.variante.sku).toMatch(/^TAZA-MAGICA-[0-9A-F]{6}$/);
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).codigo).toBe("SKU_EN_USO");
  });

  it("audita el cambio de precio con el valor anterior y el nuevo", async () => {
    const product = await setupProduct("ESTANDAR");
    const { variante } = await (await addVariant(product.id, { precioCentavos: 150000 })).json();

    const response = await patchVariant(
      apiRequest(`/api/admin/variants/${variante.id}`, { method: "PATCH", cookie: admin.cookie, body: { precioCentavos: 175000 } }),
      params({ id: variante.id }),
    );

    expect(response.status).toBe(200);
    const event = await getDb().eventoAuditoria.findFirstOrThrow({ where: { accion: "PRECIO_MODIFICADO" } });
    expect(event).toMatchObject({ actorId: admin.id, entidadId: variante.id, datos: { antesCentavos: 150000, despuesCentavos: 175000 } });
  });

  it("una variante inexistente o con id inválido da 404", async () => {
    for (const id of [crypto.randomUUID(), "no-es-uuid"]) {
      const response = await patchVariant(
        apiRequest(`/api/admin/variants/${id}`, { method: "PATCH", cookie: admin.cookie, body: { activa: false } }),
        params({ id }),
      );
      expect(response.status).toBe(404);
    }
  });
});
