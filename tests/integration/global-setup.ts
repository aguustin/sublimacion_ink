import { execSync } from "node:child_process";

// Aplica las migraciones a la base de pruebas antes de correr la suite de integración.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("Falta TEST_DATABASE_URL. Copiá .env.example a .env y levantá la base con `npm run db:up`.");
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
