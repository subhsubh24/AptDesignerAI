import { createLogger } from "@/lib/logging/logger";
import { withRetry, isRetryableError } from "@/lib/ai/retry";
import { pLimit } from "@/lib/utils/p-limit";

const log = createLogger("tavily");

const TAVILY_BASE = "https://api.tavily.com";

function getApiKey(): string {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set");
  return key;
}

// ─── Rate limiting ───────────────────────────────────────────────
//
// Tavily dev tier = 100 RPM, prod = 1000 RPM. pLimit alone caps concurrency
// but not request RATE — when each call is fast (~1s), 8 concurrent calls
// produce ~480 RPM and trigger 429s. We layer a sliding-window RPM gate on
// top of pLimit so every request waits until the trailing-60s count is
// below cap before being dispatched.

interface RateConfig { concurrency: number; rpm: number }

function readRateConfig(): RateConfig {
  const tier = process.env.TAVILY_RATE_TIER ?? "dev";
  const concEnv = Number(process.env.TAVILY_CONCURRENCY || "0");
  const rpmEnv = Number(process.env.TAVILY_RPM || "0");
  // Conservative defaults — leave headroom under Tavily's 100/1000 RPM caps.
  const defaults = tier === "prod"
    ? { concurrency: 30, rpm: 800 }
    : { concurrency: 5, rpm: 80 };
  return {
    concurrency: concEnv > 0 ? concEnv : defaults.concurrency,
    rpm: rpmEnv > 0 ? rpmEnv : defaults.rpm,
  };
}

let _config: RateConfig | null = null;
let _concurrencyLimit: ReturnType<typeof pLimit> | null = null;
const _requestTimestamps: number[] = [];

function getConfig(): RateConfig {
  if (!_config) _config = readRateConfig();
  return _config;
}

function getConcurrencyLimit(): ReturnType<typeof pLimit> {
  if (!_concurrencyLimit) _concurrencyLimit = pLimit(getConfig().concurrency);
  return _concurrencyLimit;
}

/** Wait until the trailing-60s request count is < rpm cap, then record this request. */
async function waitForRateSlot(): Promise<void> {
  const { rpm } = getConfig();
  while (true) {
    const now = Date.now();
    // Drop timestamps older than 60s
    while (_requestTimestamps.length > 0 && _requestTimestamps[0] < now - 60_000) {
      _requestTimestamps.shift();
    }
    if (_requestTimestamps.length < rpm) {
      _requestTimestamps.push(now);
      return;
    }
    // Sleep until oldest entry rolls out of the window (+50ms safety margin)
    const wait = 60_000 - (now - _requestTimestamps[0]) + 50;
    await new Promise((r) => setTimeout(r, Math.max(wait, 100)));
  }
}

/** Execute fn under both concurrency cap AND RPM rate limit. */
function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  return getConcurrencyLimit()(async () => {
    await waitForRateSlot();
    return fn();
  });
}

// ─── Search types ────────────────────────────────────────────────

export interface TavilySearchOptions {
  query: string;
  search_depth?: "basic" | "advanced" | "fast" | "ultra-fast";
  topic?: "general" | "news" | "finance";
  max_results?: number;
  include_domains?: string[];
  exclude_domains?: string[];
  include_answer?: boolean | "basic" | "advanced";
  include_raw_content?: boolean | "markdown" | "text";
  include_images?: boolean;
  country?: string;
  time_range?: "day" | "week" | "month" | "year";
  chunks_per_source?: number;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content?: string;
  published_date?: string;
  images?: Array<{ url: string; description?: string }>;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
  answer?: string;
  images?: Array<{ url: string; description?: string }>;
  response_time: number;
}

// ─── Extract types ───────────────────────────────────────────────

export interface TavilyExtractOptions {
  urls: string | string[];
  extract_depth?: "basic" | "advanced";
  include_images?: boolean;
  query?: string;
  chunks_per_source?: number;
  format?: "markdown" | "text";
  timeout?: number;
}

export interface TavilyExtractResult {
  url: string;
  raw_content: string;
  images?: string[];
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failed_results: Array<{ url: string; error: string }>;
  response_time: number;
}

// ─── HTTP helper ─────────────────────────────────────────────────

function isTavilyRetryable(error: unknown): boolean {
  if (isRetryableError(error)) return true;
  if (error instanceof TavilyError && error.status === 429) return true;
  return false;
}

export class TavilyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TavilyError";
  }
}

async function tavilyPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const apiKey = getApiKey();
  const url = `${TAVILY_BASE}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let retryAfterMs: number | undefined;
    if (res.status === 429) {
      const ra = res.headers.get("retry-after");
      if (ra) {
        const seconds = Number(ra);
        retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : undefined;
      }
    }
    throw new TavilyError(
      `Tavily ${path} failed: ${res.status} ${res.statusText}`,
      res.status,
      text,
      retryAfterMs,
    );
  }

  return (await res.json()) as T;
}

// ─── Public API ──────────────────────────────────────────────────

export async function tavilySearch(opts: TavilySearchOptions): Promise<TavilySearchResponse> {
  const start = Date.now();

  const result = await rateLimited(() =>
    withRetry(
      () =>
        tavilyPost<TavilySearchResponse>("/search", {
          query: opts.query,
          ...(opts.search_depth && { search_depth: opts.search_depth }),
          ...(opts.topic && { topic: opts.topic }),
          ...(opts.max_results !== undefined && { max_results: opts.max_results }),
          ...(opts.include_domains?.length && { include_domains: opts.include_domains }),
          ...(opts.exclude_domains?.length && { exclude_domains: opts.exclude_domains }),
          ...(opts.include_answer !== undefined && { include_answer: opts.include_answer }),
          ...(opts.include_raw_content !== undefined && { include_raw_content: opts.include_raw_content }),
          ...(opts.include_images !== undefined && { include_images: opts.include_images }),
          ...(opts.country && { country: opts.country }),
          ...(opts.time_range && { time_range: opts.time_range }),
          ...(opts.chunks_per_source !== undefined && { chunks_per_source: opts.chunks_per_source }),
        }),
      {
        maxAttempts: 4,
        baseDelayMs: 3000,
        maxDelayMs: 30000,
        isRetryable: isTavilyRetryable,
        onRetry: async (attempt, delay, error) => {
          // Honor Retry-After header on 429 — wait the server's stated time.
          if (error instanceof TavilyError && error.retryAfterMs && error.retryAfterMs > delay) {
            await new Promise((r) => setTimeout(r, error.retryAfterMs! - delay));
          }
          log.warn("tavily search retry", {
            attempt,
            delayMs: delay,
            query: opts.query.slice(0, 60),
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    ),
  );

  log.info("tavily search complete", {
    query: opts.query.slice(0, 60),
    results: result.results.length,
    durationMs: Date.now() - start,
    responseTimeMs: result.response_time * 1000,
  });

  return result;
}

export async function tavilyExtract(opts: TavilyExtractOptions): Promise<TavilyExtractResponse> {
  const urls = Array.isArray(opts.urls) ? opts.urls : [opts.urls];
  const start = Date.now();

  const result = await rateLimited(() =>
    withRetry(
      () =>
        tavilyPost<TavilyExtractResponse>("/extract", {
          urls,
          ...(opts.extract_depth && { extract_depth: opts.extract_depth }),
          ...(opts.include_images !== undefined && { include_images: opts.include_images }),
          ...(opts.query && { query: opts.query }),
          ...(opts.chunks_per_source !== undefined && { chunks_per_source: opts.chunks_per_source }),
          ...(opts.format && { format: opts.format }),
          ...(opts.timeout !== undefined && { timeout: opts.timeout }),
        }),
      {
        maxAttempts: 4,
        baseDelayMs: 3000,
        maxDelayMs: 30000,
        isRetryable: isTavilyRetryable,
        onRetry: async (attempt, delay, error) => {
          if (error instanceof TavilyError && error.retryAfterMs && error.retryAfterMs > delay) {
            await new Promise((r) => setTimeout(r, error.retryAfterMs! - delay));
          }
          log.warn("tavily extract retry", {
            attempt,
            delayMs: delay,
            urlCount: urls.length,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    ),
  );

  log.info("tavily extract complete", {
    urlCount: urls.length,
    successCount: result.results.length,
    failedCount: result.failed_results.length,
    durationMs: Date.now() - start,
    responseTimeMs: result.response_time * 1000,
  });

  return result;
}
