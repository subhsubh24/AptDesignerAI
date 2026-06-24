// Flat config for ESLint 9 — stops ESLint traversal at mobile/ so it never
// picks up the repo root's eslint.config.mjs (which imports from root
// node_modules that are not installed during mobile-only CI runs).
import expo from "eslint-config-expo/flat";

export default [
  ...expo,
  {
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "jsx-a11y/alt-text": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
