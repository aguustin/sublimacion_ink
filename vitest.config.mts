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
            LOG_LEVEL: "silent",
          },
          fileParallelism: false,
        },
      },
    ],
  },
});
