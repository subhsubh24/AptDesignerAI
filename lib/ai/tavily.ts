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

function getRateLimit(): ReturnType<typeof pLimit> {
  const tier = process.env.TAVILY_RATE_TIER ?? "dev";
  // Conservative caps — bursts of 15 dev requests routinely hit 429 in practice.
  // Override via TAVILY_CONCURRENCY env var.
  const envOverride = Number(process.env.TAVILY_CONCURRENCY || "0");
  const concurrency = envOverride > 0 ? envOverride : (tier === "prod" ? 50 : 8);
  return pLimit(concurrency);
}

let _limiter: ReturnType<typeof pLimit> | null = null;
function limiter() {
  if (!_limiter) _limiter = getRateLimit();
  return _limiter;
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

  const result = await limiter()(() =>
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

  const result = await limiter()(() =>
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
