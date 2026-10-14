import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Opcional para que `prisma generate` (postinstall) funcione sin .env; las migraciones sí la necesitan.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
