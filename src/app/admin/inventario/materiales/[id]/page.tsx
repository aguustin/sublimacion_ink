import { notFound } from "next/navigation";
import { requireAdminPage } from "@/app/session";
import { available, getMaterial, listMovements } from "@/server/modules/inventory/stock.service";
import { AppError } from "@/server/shared/errors";
import { MaterialEditForm, StockMovementForm } from "../../material-forms";
import { MovementsTable } from "../../movements-table";

export const dynamic = "force-dynamic";

export default async function MaterialStockPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const material = await getMaterial(id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const movements = await listMovements({ materialId: id });

  return (
    <main>
      <h1>{material.nombre}</h1>
      <p>
        Físico: {material.stockFisico} {material.unidad} · Disponible: {available(material)} {material.unidad}
        {!material.activo && " · Inactivo"}
      </p>
      <StockMovementForm endpoint={`/api/admin/materials/${material.id}/stock-movements`} />
      <h2>Datos</h2>
      <MaterialEditForm material={material} />
      <h2>Movimientos</h2>
      <MovementsTable movements={movements} />
    </main>
  );
}
