import { requireAdminPage } from "@/app/session";
import { listCategories } from "@/server/modules/catalog/catalog-admin.service";
import { CategoriesManager } from "./categories-manager";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  await requireAdminPage();
  const categories = await listCategories();
  return (
    <main>
      <h1>Categorías</h1>
      <CategoriesManager
        categories={categories.map((category) => ({
          id: category.id,
          nombre: category.nombre,
          slug: category.slug,
          activa: category.activa,
          productos: category._count.productos,
        }))}
      />
    </main>
  );
}
