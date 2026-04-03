import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Ban raw console calls in AI pipeline code — use lib/logging/logger.ts instead.
  // The logger itself and store infrastructure are exempted.
  {
    files: ["lib/agents/**/*.ts", "lib/ai/**/*.ts", "lib/scoring/**/*.ts", "lib/prompts/**/*.ts"],
    ignores: ["lib/logging/**"],
    rules: {
      "no-console": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
