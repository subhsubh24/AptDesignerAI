import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts", "evals/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/types/**", "lib/design-context/**"],
      // Floors sit ~10pts below the real numbers (≈50/39/54/51 stmts/branch/
      // funcs/lines, measured with `npm run test:coverage`, evals skipped) so a
      // genuine coverage regression fails that command while normal variance does
      // not. Raise these as coverage climbs; never lower them below reality — a
      // floor far under actual is decorative and trains everyone to ignore it.
      // NOTE: these gate `npm run test:coverage` only; the CI `verify` job runs
      // bare `vitest run` (no --coverage), so a coverage regression is NOT yet
      // caught in CI. Wiring test:coverage into the CI verify job is a separate,
      // human-applied step (the loop cannot edit .github/).
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 42,
        lines: 40,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
