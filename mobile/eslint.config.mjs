// Flat config for ESLint 9 — stops ESLint traversal at mobile/ so it never
// picks up the repo root's eslint.config.mjs (which imports from root
// node_modules that are not installed during mobile-only CI runs).
import expo from "eslint-config-expo/flat.js";

const config = [
  ...expo,
  {
    rules: {
      "jsx-a11y/alt-text": "off",
      // React Native uses synchronous setState in effects for initialization
      // (SSR hydration detection, early-return guards). This is intentional
      // and a well-established RN pattern — not a bug.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // MUST stay scoped to TS files. `eslint-config-expo/flat.js` registers the
    // `@typescript-eslint` PLUGIN only inside its own config object for
    // ["**/*.ts","**/*.tsx","**/*.d.ts"] — and in flat config a rule may only
    // reference a plugin that is defined for the same files. An UNSCOPED block
    // carrying `@typescript-eslint/*` rules therefore applies them to .js/.mjs
    // too (this file, metro.config.js, scripts/reset-project.js), where the
    // plugin does not exist, and ESLint aborts the whole run with
    // "could not find plugin @typescript-eslint" before linting a single file.
    // That is not a warning — it lints NOTHING, so `expo lint` silently stops
    // being a gate. Keep these two rules here, not in the block above.
    files: ["**/*.ts", "**/*.tsx", "**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
export default config;
