import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { getInventoryOverview, reconcileStock } from "@/server/modules/inventory/stock.service";
import { MaterialCreateForm } from "./material-forms";

export const dynamic = "force-dynamic";

const variantLabel = (variant: { sku: string; material: string | null; medida: string | null; color: string | null; talle: string | null }) =>
  [variant.material, variant.medida, variant.color, variant.talle].filter(Boolean).join(" · ") || variant.sku;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ bajo?: string }> }) {
  await requireAdminPage();
  const onlyLow = (await searchParams).bajo === "1";
  const [{ variantes, materiales }, diferencias] = await Promise.all([getInventoryOverview({ onlyLow }), reconcileStock()]);

  return (
    <main>
      <h1>Inventario</h1>
      <p>
        {onlyLow ? <Link href="/admin/inventario">Ver todo</Link> : <Link href="/admin/inventario?bajo=1">Ver solo stock bajo</Link>}
      </p>
      <p role="status">
        Conciliación:{" "}
        {diferencias.length === 0
          ? "el stock coincide con los movimientos y las retenciones."
          : `${diferencias.length} diferencia(s). Revisá el log del servidor.`}
      </p>

      <h2>Variantes</h2>
      <p>Disponible = físico − reservado. Los personalizables muestran su stock acá, pero la tienda no lo publica todavía (D-18).</p>
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Variante</th>
            <th>Físico</th>
            <th>Reservado</th>
            <th>Disponible</th>
            <th>Alerta</th>
          </tr>
        </thead>
        <tbody>
          {variantes.map((variant) => (
            <tr key={variant.id}>
              <td>
                {variant.producto.nombre}
                {!variant.producto.activo && " (inactivo)"}
              </td>
              <td>
                <Link href={`/admin/inventario/variantes/${variant.id}`}>{variantLabel(variant)}</Link>
                {!variant.activa && " (inactiva)"}
              </td>
              <td>{variant.stockFisico}</td>
              <td>{variant.stockReservado}</td>
              <td>{variant.disponible}</td>
              <td>{variant.stockBajo ? "Stock bajo" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Materiales</h2>
      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th>Unidad</th>
            <th>Físico</th>
            <th>Disponible</th>
            <th>Alerta</th>
          </tr>
        </thead>
        <tbody>
          {materiales.map((material) => (
            <tr key={material.id}>
              <td>
                <Link href={`/admin/inventario/materiales/${material.id}`}>{material.nombre}</Link>
                {!material.activo && " (inactivo)"}
              </td>
              <td>{material.unidad}</td>
              <td>{material.stockFisico}</td>
              <td>{material.disponible}</td>
              <td>{material.stockBajo ? "Stock bajo" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Nuevo material</h3>
      <MaterialCreateForm />
    </main>
  );
}
