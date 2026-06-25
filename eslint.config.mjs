import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Allow _-prefixed variables and parameters to signal intentionally-unused args.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  // Ban raw console calls in AI pipeline code — use lib/logging/logger.ts instead.
  // The logger itself and store infrastructure are exempted.
  {
    files: ["lib/agents/**/*.ts", "lib/ai/**/*.ts", "lib/scoring/**/*.ts", "lib/prompts/**/*.ts"],
    ignores: ["lib/logging/**"],
    rules: {
      "no-console": "error",
    },
  },
  // Mobile app (Expo / React Native) — allow require() for static assets, ignore alt-text on images
  {
    files: ["mobile/**/*.ts", "mobile/**/*.tsx", "mobile/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "jsx-a11y/alt-text": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vitest coverage output:
    "coverage/**",
  ]),
]);

export default eslintConfig;
