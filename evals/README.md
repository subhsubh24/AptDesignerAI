# Evaluation harness

Regression tests for the AI pipeline. Unlike the unit suite under
`__tests__/`, evals make real Gemini calls and are gated behind
`RUN_EVALS=1` so CI and local dev don't burn tokens unintentionally.

## Layout

- `evals/gold/` — curated gold cases, one JSON file per scenario. Each
  file holds an `input` + `expectations` block (see schema below).
- `evals/runner.ts` — thin helpers to load cases, execute a pipeline
  under test, and score the output against the expectations.
- `evals/__tests__/*.eval.test.ts` — Vitest tests that wire runner +
  gold set. Skip by default; set `RUN_EVALS=1` to execute.

## Running

```bash
# Fast feedback loop — requires GEMINI_API_KEY
RUN_EVALS=1 npm run eval

# In CI, usually scheduled or on pre-release branches only.
RUN_EVALS=1 npm run eval -- --reporter=verbose
```

## Gold case schema

```jsonc
{
  "id": "studio-living-room-01",
  "description": "Small studio, keep brass lamp, warm palette",
  "input": {
    "roomType": "living_room",
    "imageUrls": ["https://.../room.jpg"],
    "userContext": "Keep the brass floor lamp. Warm palette.",
    "keepItems": ["brass floor lamp"],
    "budgetMode": "balanced"
  },
  "expectations": {
    /** Must include these items in `what_works`. */
    "mustKeep": ["brass floor lamp"],
    /** Recommended palette must overlap these warm tones. */
    "paletteIncludes": ["terracotta", "warm white", "camel"],
    /** Final validation confidence must be ≥ this bound. */
    "minValidationConfidence": 0.7,
    /** No item from this list may appear in `what_should_go`. */
    "mustNotDrop": ["brass floor lamp"]
  }
}
```

## Adding a case

1. Drop a new JSON file under `evals/gold/`.
2. Run `RUN_EVALS=1 npm run eval` and inspect the diff report.
3. If the baseline shifts for known-good reasons, re-commit the updated
   expectations block.
