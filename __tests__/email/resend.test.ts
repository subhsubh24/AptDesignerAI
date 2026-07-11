import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResendProvider } from "@/lib/email/resend";
import type { EmailMessage } from "@/lib/email/types";

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
    expect(body).not.toHaveProperty("text");
    expect(body).not.toHaveProperty("reply_to");
  });
});
