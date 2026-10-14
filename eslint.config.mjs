import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "src/generated/**", "next-env.d.ts", "coverage/**"]),
  {
    // La lógica de negocio no depende del framework (especificación, sección 12).
    files: ["src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "@/app/*"],
              message: "src/server no puede depender de Next.js ni de la interfaz (especificación, sección 12).",
            },
          ],
        },
      ],
    },
  },
]);
