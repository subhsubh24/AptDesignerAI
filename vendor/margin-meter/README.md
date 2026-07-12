# @margin/meter (TypeScript SDK)

The tiny client a **TypeScript/JavaScript** project imports to connect to
Margin — the TS twin of the Python [`margin-meter`](../python) package. It wraps
your LLM calls and records their outcomes, emitting each one **over HTTP** to a
Margin **ingest API** (`POST /api/ingest/calls` / `/api/ingest/outcomes`),
authenticated with a per-project ingest key.

- **Dependency-free.** Uses the global `fetch` — nothing to install at runtime.
- **Fail-safe.** A failed emit resolves to `{ ok: false, … }` instead of throwing.
  Pass `raiseOnError: true` for strict/CI behaviour.
- **Provenance-honest.** `isSimulated` is carried through untouched; the written
  `source` is forced server-side to your key's project — you cannot spoof another
  project's economics.

## Install

Published as a git-installable subpath of the Margin repo (no npm registry
account needed pre-launch):

```bash
npm install "github:subhsubh24/Margin.ai#main" --workspace=@margin/meter
# or, pinning the subdirectory with your package manager of choice, e.g. pnpm:
# pnpm add "https://gitpkg.now.sh/subhsubh24/Margin.ai/sdk/ts?main"
```

Most TS projects import the source directly (their bundler compiles it); the
package `exports` point at `src/index.ts` with types.

## Configure

Two environment variables — the deployed API base and your project's key:

```bash
export MARGIN_INGEST_URL="https://margin-ai-rho.vercel.app"
export MARGIN_INGEST_KEY="mgk_…"   # issued by the Margin owner
```

The Margin owner issues your project a key with the provisioning CLI in the
Margin repo (`python3 scripts/issue_ingest_key.py <your-project-slug>`). The raw
`mgk_…` key is shown once — only its hash is stored.

## Use

```ts
import { MarginMeter } from "@margin/meter";

const meter = new MarginMeter(); // reads MARGIN_INGEST_URL + MARGIN_INGEST_KEY

// 1) Wrap the LLM call — latency is timed automatically, cost computed server-side.
const answer = await meter.measure(
  { workflowId: "cart-parse", provider: "google", model: "gemini-2.5-flash" },
  async (m) => {
    const resp = await callTheModel(/* … */);
    m.setTokens({ inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800 });
    return resp;
  },
);

// 2) Record the outcome it produced (the unit of productivity).
await meter.recordOutcome({
  workflowId: "cart-parse",
  passed: true,
  qualityScore: 0.94,
  qualityMethod: "ground_truth",
});
```

Or record a call directly:

```ts
const res = await meter.recordCall({
  workflowId: "cart-parse",
  provider: "google",
  model: "gemini-2.5-flash",
  inputTokens: 1200,
  outputTokens: 300,
});
if (!res.ok) console.warn(`margin ingest failed: ${res.error} (${res.statusCode})`);
```

## API

| Method | Emits to | Notes |
| --- | --- | --- |
| `recordCall(input)` | `POST /api/ingest/calls` | cost computed from the pricing table when `costUsd` omitted |
| `recordOutcome(input)` | `POST /api/ingest/outcomes` | `qualityMethod` records HOW the score was graded |
| `measure(input, fn)` | `recordCall` on completion | times latency; `status:"error"` + rethrow if `fn` throws; returns `fn`'s value, emit result on `m.result` |

Every method resolves to an `IngestResult { ok, statusCode, body?, error? }`.
`ok` is true only on HTTP 200; `body` holds `call_id`/`outcome_id` + `source`.

## Testing against the ingest contract (no network)

The network boundary is a single `post(path, { json, headers })` protocol, so a
test can inject a fake that mimics the ingest API's documented 200/401/422/429
responses:

```ts
const meter = new MarginMeter({ apiKey: "mgk_…", transport: fakeIngest, raiseOnError: true });
```

See `test/meter.test.mjs`. Run with `npm test`
(`node --experimental-strip-types --test test/*.test.mjs` — zero deps).

## Rate + validation bounds

Ingest is auth'd, validated, and rate-bounded server-side: bad key → 401,
malformed/implausible row → 422, full rolling per-project window → 429. In
fail-safe mode these come back as `{ ok: false, statusCode }`.
