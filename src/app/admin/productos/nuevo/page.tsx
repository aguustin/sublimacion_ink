import { requireAdminPage } from "@/app/session";
import { listCategories } from "@/server/modules/catalog/catalog-admin.service";
import { ProductCreateForm } from "./product-create-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  await requireAdminPage();
  const categories = await listCategories();
  return (
    <main>
      <h1>Nuevo producto</h1>
      <ProductCreateForm categories={categories.map(({ id, nombre }) => ({ id, nombre }))} />
    </main>
  );
}
