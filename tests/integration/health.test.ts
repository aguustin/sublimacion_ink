import { afterAll, describe, expect, it } from "vitest";
import { GET as getHealthRoute } from "@/app/api/health/route";
import { GET as getReadyRoute } from "@/app/api/health/ready/route";
import { getReadiness } from "@/server/modules/health/health.service";
import { createDb, getDb } from "@/server/shared/db";
import { REQUEST_ID_HEADER } from "@/server/shared/http";

afterAll(async () => {
  await getDb().$disconnect();
});

describe("GET /api/health", () => {
  it("responde 200 sin consultar la base de datos", async () => {
    const response = await getHealthRoute(new Request("http://localhost/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ estado: "ok", entorno: "local" });
  });
});

describe("GET /api/health/ready", () => {
  it("responde 200 cuando la base de datos está disponible", async () => {
    const response = await getReadyRoute(new Request("http://localhost/api/health/ready"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ estado: "ok", entorno: "local", baseDeDatos: "ok" });
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("informa 503 con una base de datos inalcanzable", async () => {
    const unreachable = createDb("postgresql://nadie:nada@127.0.0.1:1/inexistente");

    await expect(getReadiness(unreachable)).rejects.toMatchObject({
      code: "BASE_DE_DATOS_NO_DISPONIBLE",
      status: 503,
    });
    await unreachable.$disconnect();
  });
});

describe("migraciones", () => {
  it("están aplicadas en la base de pruebas sin fallas", async () => {
    const rows = await getDb().$queryRaw<{ total: bigint; pendientes: bigint }[]>`
      SELECT count(*) AS total, count(*) FILTER (WHERE finished_at IS NULL) AS pendientes
      FROM _prisma_migrations`;

    expect(Number(rows[0]?.total)).toBeGreaterThan(0);
    expect(Number(rows[0]?.pendientes)).toBe(0);
  });
});
