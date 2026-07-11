import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResendProvider } from "@/lib/email/resend";
import type { EmailMessage } from "@/lib/email/types";

// The provider talks to Resend's REST API directly over the global `fetch`.
// We stub `fetch` so every branch of send() can be driven without a network
// call — this is the transactional-delivery path (activation, receipts,
// waitlist confirmation), so its failure/parse handling must not regress.

const BASE_MESSAGE: EmailMessage = {
  to: "user@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
};

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  } as unknown as Response;
}

describe("ResendProvider.send", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns delivered:true with the provider message id on a 200", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "msg_123" }));
    const provider = new ResendProvider("re_key", "from@app.com");

    const result = await provider.send(BASE_MESSAGE);

    expect(result).toEqual({ delivered: true, dryRun: false, id: "msg_123" });
  });

  it("still reports delivered when the 200 body carries no id (id undefined)", async () => {
    // A missing id must NOT be treated as a failure — the message was accepted.
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new ResendProvider("re_key", "from@app.com");

    const result = await provider.send(BASE_MESSAGE);

    expect(result).toEqual({ delivered: true, dryRun: false, id: undefined });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("treats a body that fails JSON parsing as an accepted send with no id", async () => {
    const res = {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response;
    fetchMock.mockResolvedValue(res);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new ResendProvider("re_key", "from@app.com");

    const result = await provider.send(BASE_MESSAGE);

    expect(result).toEqual({ delivered: true, dryRun: false, id: undefined });
  });

  it("returns a non-delivered result carrying only the status on a non-2xx (no PII body)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse(422, { message: "user@example.com is suppressed" }, "Unprocessable"));
    const provider = new ResendProvider("re_key", "from@app.com");

    const result = await provider.send(BASE_MESSAGE);

    expect(result.delivered).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(result.error).toBe("Email provider returned 422");
    // The recipient address must never surface in the returned error summary.
    expect(result.error).not.toContain("user@example.com");
    err.mockRestore();
  });

  it("returns 'unreachable' (delivered:false) when fetch rejects (network error / timeout)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));
    const provider = new ResendProvider("re_key", "from@app.com");

    const result = await provider.send(BASE_MESSAGE);

    expect(result).toEqual({ delivered: false, dryRun: false, error: "Email provider unreachable" });
    err.mockRestore();
  });

  it("sends a Bearer-authorized JSON POST with the recipient as an array", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "x" }));
    const provider = new ResendProvider("re_secret", "from@app.com");

    await provider.send(BASE_MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_secret");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body.from).toBe("from@app.com");
    expect(body.to).toEqual(["user@example.com"]);
    // Optional fields are omitted when unset.
    expect(body).not.toHaveProperty("text");
    expect(body).not.toHaveProperty("reply_to");
  });

  it("includes text and reply_to in the payload only when the message sets them", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "x" }));
    const provider = new ResendProvider("re_key", "from@app.com");

    await provider.send({ ...BASE_MESSAGE, text: "plain", replyTo: "reply@app.com" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe("plain");
    expect(body.reply_to).toBe("reply@app.com");
  });
});
