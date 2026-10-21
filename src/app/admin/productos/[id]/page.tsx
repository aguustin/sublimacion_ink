import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/app/session";
import { getAdminProduct, listCategories } from "@/server/modules/catalog/catalog-admin.service";
import { productImageUrls } from "@/server/modules/catalog/product-images.service";
import { AppError } from "@/server/shared/errors";
import { ProductEditor } from "./product-editor";
import { ProductImages } from "./product-images";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const product = await getAdminProduct(id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const [categories, imageUrls] = await Promise.all([listCategories(), productImageUrls(product.imagenes.map((image) => image.archivoId))]);

  return (
    <main>
      <h1>{product.nombre}</h1>
      <p>
        {product.tipo === "ESTANDAR" ? "Estándar" : "Personalizable"} ·{" "}
        {product.activo ? <Link href={`/productos/${product.slug}`}>Ver en la tienda</Link> : "Inactivo"}
      </p>
      <ProductEditor
        product={{
          id: product.id,
          nombre: product.nombre,
          descripcion: product.descripcion,
          categoriaId: product.categoriaId,
          tipo: product.tipo,
          activo: product.activo,
        }}
        variants={product.variantes.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          material: variant.material,
          medida: variant.medida,
          color: variant.color,
          talle: variant.talle,
          precioCentavos: variant.precioCentavos,
          activa: variant.activa,
          stockFisico: variant.stockFisico,
          stockReservado: variant.stockReservado,
        }))}
        categories={categories.map((category) => ({ id: category.id, nombre: category.nombre }))}
      />
      <ProductImages
        productId={product.id}
        images={product.imagenes.map((image) => ({
          archivoId: image.archivoId,
          nombre: image.archivo.nombreOriginal,
          url: imageUrls.get(image.archivoId) ?? null,
        }))}
      />
    </main>
  );
}
