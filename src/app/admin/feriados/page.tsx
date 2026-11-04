import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { listHolidays } from "@/server/modules/orders/holidays.service";
import { HolidaysManager } from "./holidays-manager";
import { PageHeader } from "../page-header";

export const dynamic = "force-dynamic";

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  await requireAdminPage();
  const holidays = await listHolidays((await searchParams).anio);
  const year = Number((await searchParams).anio) || new Date().getUTCFullYear();

  return (
    <main>
      <PageHeader
        title={`Feriados ${year}`}
        description="Los feriados no cuentan para el plazo de 24 h de las reservas en efectivo, igual que los fines de semana. Al agregar uno, las reservas vigentes que lo incluyen se extienden; quitarlo no acorta las ya creadas."
      >
        <nav aria-label="Años">
          <Link href={`/admin/feriados?anio=${year - 1}`} className="ink-btn">
            <ChevronLeft aria-hidden="true" size={18} />
            {year - 1}
          </Link>
          <Link href={`/admin/feriados?anio=${year + 1}`} className="ink-btn">
            {year + 1}
            <ChevronRight aria-hidden="true" size={18} />
          </Link>
        </nav>
      </PageHeader>
      <HolidaysManager holidays={holidays.map((holiday) => ({ id: holiday.id, fecha: holiday.fecha.toISOString().slice(0, 10), descripcion: holiday.descripcion }))} />
    </main>
  );
}
