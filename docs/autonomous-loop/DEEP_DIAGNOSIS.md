# DEEP DIAGNOSIS — "it builds/deploys but the user hits an error"

The discipline for any reported runtime failure where the build is green but a real
user hits an error. A green build + green tests prove the code COMPILES, not that the
running system WORKS (see FACTORY_STANDARD §6, BUILDS ≠ WORKS). Reading code and
theorizing is the slow, wrong first move — observe the REAL environment first. Follow
this method on every such incident, and record each incident (symptom → evidence →
root cause → fix → proof) in the loop-memory file.

## The method

1. **Observe the REAL environment — don't read code and theorize.** Pull production
   logs + query the live DB (Supabase MCP: `get_logs`, `execute_sql`, `list_tables`,
   `get_advisors`), or reproduce the exact user journey. The logs usually name the
   cause in seconds — read them FIRST.
2. **BUILDS ≠ WORKS — separate three layers:** CODE (a real bug), DATA (schema/migration
   drift, bad rows), CONFIG (missing/wrong env var, connecting as the wrong DB role).
   Decide which with EVIDENCE before changing anything. (e.g. "no new row + no DB error +
   no app→DB connection" → it's config, not code.)
3. **Form ONE hypothesis, then PROVE it against the live system** — test the exact insert
   under the restricted role; diff the code's schema vs the live DB column-by-column;
   confirm a row is / isn't created. If you can't prove it, you don't understand it yet.
4. **Find the UNCAUGHT throw.** A try/catch that degrades gracefully cannot be the source
   of a hard error screen — hunt the unguarded call (a bare auth/session read, a
   `loadEnv()`, a DB call outside the try, an LLM / 3rd-party call with no timeout). The
   error-boundary copy tells you which route threw.
5. **Verify the fix in the REAL system, not the build** — watch the new row appear / the
   query succeed / the journey complete. "Tests pass" is necessary, not sufficient. If you
   can't click it, verify in the data and SAY SO.
6. **Fix the ROOT cause, add a regression test, and make it fail LOUD next time** — never
   paper a config bug with a code workaround; turn the silent trap that hid it into a loud
   error or a bounded call.
7. **Peel the layers** — fixing one error reveals the next (one real outage stacked FOUR
   causes). Keep going until the real journey works end to end, not until the first error
   disappears.
8. **Stay honest** — change your diagnosis the moment evidence contradicts it; never claim
   "fixed" without proof.

## Two hard rules (each came out of a real outage)

- **(a) Timeouts.** Any external / LLM / 3rd-party call MUST have a timeout SHORTER than
  the serverless function budget — a graceful try/catch is useless if the runtime kills
  the function first.
- **(b) Required env is not optional.** An `.optional()` env var that a critical path
  actually requires is a latent outage — make it FAIL LOUD (assert at boot / startup),
  never silently undefined.

## Where this fits

- Triggered by: a reported / observed "builds but errors" runtime failure, and by the
  periodic deep-audit FUNCTIONAL REALITY lens when a journey errors against a running app.
- Cross-refs: FACTORY_STANDARD §6 (BUILDS ≠ WORKS + SIDE-EFFECT INTEGRITY), §10 (deep
  audit). Record each incident in the loop-memory file so the next diagnosis can diff.
