import type { Metadata } from "next";
import { requireAdminPage } from "@/app/session";
import { listExclusions } from "@/server/modules/orders/cancellation-window.service";
import { ExclusionsManager } from "./exclusions-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Fechas excluidas · INK" };

/** Fechas completas que no cuentan para la ventana de 48 h de cancelación con cargo (RN-30, RF-59). */
export default async function ExcludedDatesPage() {
  await requireAdminPage();
  const exclusions = await listExclusions();
  return (
    <ExclusionsManager
      exclusions={exclusions.map((row) => ({ fecha: row.fecha, motivo: row.motivo, creadoPor: row.creadoPor, creadoEn: row.creadoEn.toISOString() }))}
    />
  );
}
