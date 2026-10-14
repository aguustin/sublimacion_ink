import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/app/session";
import { available, getVariantStock, listMovements } from "@/server/modules/inventory/stock.service";
import { AppError } from "@/server/shared/errors";
import { StockMovementForm, VariantThresholdForm } from "../../material-forms";
import { MovementsTable } from "../../movements-table";

export const dynamic = "force-dynamic";

export default async function VariantStockPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const variant = await getVariantStock(id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  const movements = await listMovements({ varianteId: id });

  return (
    <main>
      <h1>
        Stock de <Link href={`/admin/productos/${variant.producto.id}`}>{variant.producto.nombre}</Link> · {variant.sku}
      </h1>
      <p>
        Físico: {variant.stockFisico} · Reservado: {variant.stockReservado} · Disponible: {available(variant)}
      </p>
      <StockMovementForm endpoint={`/api/admin/variants/${variant.id}/stock-movements`} />
      <VariantThresholdForm variantId={variant.id} threshold={variant.umbralStockBajo} />
      <h2>Movimientos</h2>
      <MovementsTable movements={movements} />
    </main>
  );
}
