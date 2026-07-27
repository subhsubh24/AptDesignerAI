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
      // Floors sit ~4pts below the real numbers (64.01/53.18/68.58/65.15
      // stmts/branch/funcs/lines, measured with `npm run test:coverage`, evals
      // skipped) so a genuine coverage regression fails while normal variance
      // does not. They were 40/30/42/40 — roughly 24 points under actual, which
      // is decorative: nothing could ever trip it. Raise these as coverage
      // climbs; never lower them below reality.
      // NOTE: these gate `npm run test:coverage`, which `scripts/preflight.sh`
      // GATE 1f now runs, so a regression fails the readiness gate. The CI
      // `verify` job still runs bare `vitest run`; pointing it at
      // `npm run test:coverage` is a human-applied step (the loop cannot edit
      // .github/) and is recorded in PENDING_OPS.md.
      thresholds: {
        statements: 60,
        branches: 49,
        functions: 64,
        lines: 61,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
