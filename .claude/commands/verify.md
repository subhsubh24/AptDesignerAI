---
description: Run the full green-before-merge gate (types, tests, determinism)
---

Run the project's pre-merge verification gate, in this order, and stop at the
first failure (report it with the failing output, do not continue):

1. `npx tsc --noEmit` — type check must be clean.
2. `npm test` — vitest suite must pass.
3. `npm run check:determinism` — determinism check must stay green.

If `$ARGUMENTS` names a specific area (e.g. a file or feature), also run the
narrowest relevant `npx vitest run <path>` first to get fast feedback before
the full suite.

When all three pass, report a one-line green summary (counts of tests passed).
Per AGENTS.md, CI runs all of the above and it must be green before merge — so
treat any red here as a blocker, not a warning.
