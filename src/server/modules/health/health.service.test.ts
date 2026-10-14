import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";
import { getReadiness } from "./health.service";

describe("getReadiness", () => {
  it("responde 503 con código estable si la base de datos no responde", async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) } as unknown as Db;

    const error = await getReadiness(db).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "BASE_DE_DATOS_NO_DISPONIBLE", status: 503 });
  });
});
