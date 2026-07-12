/**
 * @margin/meter — the TypeScript SDK a project imports to connect to Margin.
 *
 * The TS twin of the Python `margin_meter` package: a tiny, dependency-free
 * client the three TS siblings (GroceryManager, HighlightMagic, AptDesignerAI)
 * — or any real customer — drop in to wrap their LLM calls and record the
 * outcomes, emitting each one OVER HTTP to Margin's ingest API
 * (`POST /api/ingest/calls` / `/api/ingest/outcomes`), authenticated with a
 * per-project ingest key.
 *
 * Design goals (mirroring the Python SDK):
 *  - **Dependency-free.** Uses the global `fetch` — no runtime deps to install.
 *  - **Pluggable transport (hermetically testable).** The network boundary is a
 *    single `post(path, { json, headers })` protocol, so a test can inject a
 *    fake that faithfully mimics the ingest API's documented 200/401/422/429
 *    responses. Production uses `fetch`.
 *  - **Fail-safe by default.** Telemetry must never crash the host, so a failed
 *    emit resolves to an `IngestResult { ok: false, ... }` instead of throwing.
 *    Pass `raiseOnError: true` for strict/CI behaviour.
 *  - **Provenance-honest.** `isSimulated` is carried through untouched; the
 *    written `source` is forced server-side to the key's project slug — the
 *    client cannot spoof another project's economics.
 */

export const CALLS_PATH = "/api/ingest/calls";
export const OUTCOMES_PATH = "/api/ingest/outcomes";
export const KEY_HEADER = "X-Margin-Key";
export const DEFAULT_INGEST_URL = "http://127.0.0.1:8000";
export const DEFAULT_TIMEOUT_MS = 10_000;

/** The outcome of one emit. Returned by every record call. */
export interface IngestResult {
  /** True only on an HTTP 200. */
  ok: boolean;
  /** The HTTP status, or 0 for a transport/config failure. */
  statusCode: number;
  /** The parsed success payload (`call_id`/`outcome_id` + `source`) when ok. */
  body?: Record<string, unknown>;
  /** The failure reason, when not ok. */
  error?: string;
}

/** The response shape a transport returns (a subset of the `fetch` Response). */
export interface TransportResponse {
  status: number;
  json(): Promise<unknown>;
}

/** The single network-boundary protocol. `fetch` (via FetchTransport) and any
 *  test fake both satisfy it. */
export interface Transport {
  post(
    path: string,
    opts: { json: unknown; headers: Record<string, string> },
  ): Promise<TransportResponse>;
}

/** Raised (only in strict mode) when a row is rejected by the ingest API. */
export class MarginIngestError extends Error {
  statusCode: number;
  detail: string;
  constructor(statusCode: number, detail: string) {
    super(`ingest rejected (${statusCode}): ${detail}`);
    this.name = "MarginIngestError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/** Raised (only in strict mode) when the client is missing its ingest key. */
export class MarginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarginConfigError";
  }
}

/** The default transport: POST JSON over HTTP with the global `fetch`. */
export class FetchTransport implements Transport {
  baseUrl: string;
  timeoutMs: number;
  constructor(baseUrl: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }
  async post(
    path: string,
    opts: { json: unknown; headers: Record<string, string> },
  ): Promise<TransportResponse> {
    return await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: JSON.stringify(opts.json),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}

export interface MarginMeterOptions {
  ingestUrl?: string;
  apiKey?: string;
  transport?: Transport;
  timeoutMs?: number;
  raiseOnError?: boolean;
}

export interface RecordCallInput {
  workflowId: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  latencyMs?: number;
  status?: string;
  isRetry?: boolean;
  sessionId?: string;
  promptId?: string;
  costUsd?: number;
  isSimulated?: boolean;
}

export interface RecordOutcomeInput {
  workflowId: string;
  passed: boolean;
  qualityScore?: number;
  qualityMethod?: string;
  link?: string;
  isSimulated?: boolean;
}

/** A per-project client that emits measured economics to a Margin ingest API. */
export class MarginMeter {
  ingestUrl: string;
  apiKey?: string;
  raiseOnError: boolean;
  private transport: Transport;

  constructor(options: MarginMeterOptions = {}) {
    // NOTE (vendored-copy portability fix vs upstream sdk/ts): annotate `env` so
    // property access typechecks under a strict consumer whose union would
    // otherwise be `ProcessEnv | {}`. Apply the same fix upstream on re-sync.
    const env: Record<string, string | undefined> =
      (typeof process !== "undefined" && process.env) || {};
    this.ingestUrl = options.ingestUrl || env.MARGIN_INGEST_URL || DEFAULT_INGEST_URL;
    this.apiKey = options.apiKey || env.MARGIN_INGEST_KEY;
    this.raiseOnError = options.raiseOnError ?? false;
    this.transport =
      options.transport ||
      new FetchTransport(this.ingestUrl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  private async emit(path: string, payload: Record<string, unknown>): Promise<IngestResult> {
    if (!this.apiKey) {
      const error = "no ingest key (set MARGIN_INGEST_KEY or pass apiKey)";
      if (this.raiseOnError) throw new MarginConfigError(error);
      return { ok: false, statusCode: 0, error };
    }

    let resp: TransportResponse;
    try {
      resp = await this.transport.post(path, {
        json: payload,
        headers: { [KEY_HEADER]: this.apiKey },
      });
    } catch (e) {
      const error = `transport error: ${(e as Error).message}`;
      if (this.raiseOnError) throw new MarginIngestError(0, (e as Error).message);
      return { ok: false, statusCode: 0, error };
    }

    if (resp.status === 200) {
      const body = (await resp.json()) as Record<string, unknown>;
      return { ok: true, statusCode: 200, body };
    }

    const detail = await extractDetail(resp);
    if (this.raiseOnError) throw new MarginIngestError(resp.status, detail);
    return { ok: false, statusCode: resp.status, error: detail };
  }

  /** Emit one measured LLM call. Cost is computed server-side when `costUsd`
   *  is omitted. Never throws unless `raiseOnError`. */
  async recordCall(input: RecordCallInput): Promise<IngestResult> {
    const payload: Record<string, unknown> = {
      workflow_id: input.workflowId,
      provider: input.provider,
      model: input.model,
      input_tokens: input.inputTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      cache_read_tokens: input.cacheReadTokens ?? 0,
      latency_ms: input.latencyMs ?? 0,
      status: input.status ?? "ok",
      is_retry: input.isRetry ?? false,
      is_simulated: input.isSimulated ?? false,
    };
    if (input.sessionId !== undefined) payload.session_id = input.sessionId;
    if (input.promptId !== undefined) payload.prompt_id = input.promptId;
    if (input.costUsd !== undefined) payload.cost_usd = input.costUsd;
    return await this.emit(CALLS_PATH, payload);
  }

  /** Emit one outcome (a unit of productivity). `qualityMethod` records HOW the
   *  score was graded so a self-report is never mistaken for a graded number. */
  async recordOutcome(input: RecordOutcomeInput): Promise<IngestResult> {
    const payload: Record<string, unknown> = {
      workflow_id: input.workflowId,
      passed: input.passed,
      is_simulated: input.isSimulated ?? false,
    };
    if (input.qualityScore !== undefined) payload.quality_score = input.qualityScore;
    if (input.qualityMethod !== undefined) payload.quality_method = input.qualityMethod;
    if (input.link !== undefined) payload.link = input.link;
    return await this.emit(OUTCOMES_PATH, payload);
  }

  /**
   * Time an async call and emit it on completion. The TS analogue of the
   * Python `measure` context manager: latency is timed automatically, and the
   * call is emitted with `status="error"` (and the error re-thrown) if `fn`
   * throws. Set token counts inside `fn` via `m.setTokens(...)`. Returns the
   * value `fn` produced; the emit's `IngestResult` is available as `m.result`.
   */
  async measure<T>(
    input: Omit<RecordCallInput, "latencyMs" | "status">,
    fn: (m: Measurement) => Promise<T> | T,
  ): Promise<T> {
    const m = new Measurement();
    const start = now();
    let threw = false;
    try {
      return await fn(m);
    } catch (e) {
      threw = true;
      throw e;
    } finally {
      const latencyMs = Math.round(now() - start);
      m.result = await this.recordCall({
        ...input,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        latencyMs,
        status: threw ? "error" : "ok",
      });
    }
  }
}

/** Token accumulator passed into `measure`'s callback. */
export class Measurement {
  inputTokens = 0;
  outputTokens = 0;
  cacheReadTokens = 0;
  result?: IngestResult;
  setTokens(tokens: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
  }): void {
    this.inputTokens = tokens.inputTokens ?? 0;
    this.outputTokens = tokens.outputTokens ?? 0;
    this.cacheReadTokens = tokens.cacheReadTokens ?? 0;
  }
}

async function extractDetail(resp: TransportResponse): Promise<string> {
  try {
    const body = await resp.json();
    if (body && typeof body === "object" && "detail" in body) {
      return String((body as Record<string, unknown>).detail);
    }
    return JSON.stringify(body);
  } catch {
    return "unparseable error body";
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
