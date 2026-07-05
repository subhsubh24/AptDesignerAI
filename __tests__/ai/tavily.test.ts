import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// tavily.ts is the product-search HTTP layer (200+ calls per run behind a
// concurrency + RPM gate). We cover the public surface with a mocked fetch:
// conditional request-body assembly, the non-ok -> TavilyError path with
// retry-after parsing, url normalization for extract, and the 429 retry loop.
// No network and no live key are used.

import { tavilySearch, tavilyExtract, TavilyError } from "@/lib/ai/tavily";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.TAVILY_API_KEY = "test-key";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.TAVILY_API_KEY;
});

function okJson(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, headers: new Headers() };
}

describe("TavilyError", () => {
  it("carries status, body and optional retryAfterMs", () => {
    const e = new TavilyError("boom", 429, "rate limited", 2000);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("TavilyError");
    expect(e.status).toBe(429);
    expect(e.body).toBe("rate limited");
    expect(e.retryAfterMs).toBe(2000);
  });
});

describe("tavilySearch — request assembly", () => {
  it("posts to /search with auth + only the provided optional fields", async () => {
    const resp = { query: "sofa", results: [{ title: "t", url: "u", content: "c", score: 1 }], response_time: 0.2 };
    fetchMock.mockResolvedValueOnce(okJson(resp));

    const out = await tavilySearch({ query: "sofa", search_depth: "advanced", max_results: 5 });
    expect(out).toEqual(resp);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(init.body);
    expect(body.query).toBe("sofa");
    expect(body.search_depth).toBe("advanced");
    expect(body.max_results).toBe(5);
    // fields not supplied must be omitted, not sent as undefined
    expect("topic" in body).toBe(false);
    expect("country" in body).toBe(false);
    expect("time_range" in body).toBe(false);
  });

  it("throws TavilyError on a non-retryable 400 and does not retry", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "invalid query",
      headers: new Headers(),
    });

    await expect(tavilySearch({ query: "x" })).rejects.toMatchObject({
      name: "TavilyError",
      status: 400,
      body: "invalid query",
    });
    // 400 is not retryable → exactly one attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("tavilyExtract — url normalization", () => {
  it("wraps a single url string into an array in the request body", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ results: [], failed_results: [], response_time: 0.1 }),
    );
    await tavilyExtract({ urls: "https://example.com/p" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.urls).toEqual(["https://example.com/p"]);
  });

  it("passes an array of urls through unchanged", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ results: [], failed_results: [], response_time: 0.1 }),
    );
    await tavilyExtract({ urls: ["a", "b"], extract_depth: "advanced" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.urls).toEqual(["a", "b"]);
    expect(body.extract_depth).toBe("advanced");
  });
});

describe("tavilySearch — 429 retry", () => {
  it("retries after a 429 (honoring retry-after) and then succeeds", async () => {
    vi.useFakeTimers();
    const resp = { query: "q", results: [], response_time: 0.1 };
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "slow down",
        headers: new Headers({ "retry-after": "1" }),
      })
      .mockResolvedValueOnce(okJson(resp));

    const promise = tavilySearch({ query: "q" });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual(resp);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
