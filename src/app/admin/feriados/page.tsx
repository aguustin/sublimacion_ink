import Link from "next/link";
import { requireAdminPage } from "@/app/session";
import { listHolidays } from "@/server/modules/orders/holidays.service";
import { HolidaysManager } from "./holidays-manager";

export const dynamic = "force-dynamic";

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  await requireAdminPage();
  const holidays = await listHolidays((await searchParams).anio);
  const year = Number((await searchParams).anio) || new Date().getUTCFullYear();

  return (
    <main>
      <h1>Feriados {year}</h1>
      <p>
        Los feriados no cuentan para el plazo de 24 h de las reservas en efectivo, igual que los fines de semana. Al agregar
        uno, las reservas vigentes que lo incluyen se extienden; quitarlo no acorta las ya creadas.
      </p>
      <p>
        <Link href={`/admin/feriados?anio=${year - 1}`}>{year - 1}</Link> · <Link href={`/admin/feriados?anio=${year + 1}`}>{year + 1}</Link>
      </p>
      <HolidaysManager holidays={holidays.map((holiday) => ({ id: holiday.id, fecha: holiday.fecha.toISOString().slice(0, 10), descripcion: holiday.descripcion }))} />
    </main>
  );
}
