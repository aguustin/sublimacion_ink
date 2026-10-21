import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // Las pruebas de integración usan una base propia, nunca la de desarrollo.
          env: {
            DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
            APP_URL: "http://localhost:3000",
            EMAIL_PROVIDER: "memoria",
            STORAGE_PROVIDER: "memoria",
            LOG_LEVEL: "silent",
            CRON_SECRET: "secreto-de-pruebas-del-cron-0123456789",
          },
          fileParallelism: false,
          // Cada registro calcula un hash Argon2 y las pruebas usan PostgreSQL real.
          testTimeout: 15_000,
        },
      },
    ],
  },
});
