import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DryRunProvider,
  getEmailProvider,
  isEmailDryRun,
  sendEmail,
} from "@/lib/email";
import { ResendProvider } from "@/lib/email/resend";
import type { EmailMessage } from "@/lib/email/types";

const VALID: EmailMessage = {
  to: "person@example.com",
  subject: "Welcome",
  html: "<p>Hi</p>",
  stage: "waitlist_welcome_1",
};

describe("email dry-run resolution", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
    vi.unstubAllGlobals();
  });

  it("defaults to dry-run when no RESEND_API_KEY is set", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.GROWTH_EMAIL_DRY_RUN;
    expect(isEmailDryRun()).toBe(true);
    expect(getEmailProvider()).toBeInstanceOf(DryRunProvider);
  });

  it("forces dry-run when GROWTH_EMAIL_DRY_RUN=1 even with a key present", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.GROWTH_EMAIL_DRY_RUN = "1";
    expect(isEmailDryRun()).toBe(true);
    expect(getEmailProvider()).toBeInstanceOf(DryRunProvider);
  });

  it("uses the live provider when GROWTH_EMAIL_DRY_RUN=0 and a key is present", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.GROWTH_EMAIL_DRY_RUN = "0";
    expect(isEmailDryRun()).toBe(false);
    expect(getEmailProvider()).toBeInstanceOf(ResendProvider);
  });

  it("falls back to dry-run when forced live but no key is present", () => {
    delete process.env.RESEND_API_KEY;
    process.env.GROWTH_EMAIL_DRY_RUN = "0";
    // isEmailDryRun must agree with getEmailProvider — no key means no live send.
    expect(isEmailDryRun()).toBe(true);
    expect(getEmailProvider()).toBeInstanceOf(DryRunProvider);
  });
});

describe("sendEmail validation", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.GROWTH_EMAIL_DRY_RUN;
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  it("dry-run send returns dryRun=true and delivered=false", async () => {
    const r = await sendEmail(VALID);
    expect(r.dryRun).toBe(true);
    expect(r.delivered).toBe(false);
    expect(r.id).toBe("dryrun:waitlist_welcome_1");
  });

  it("rejects an invalid recipient without sending", async () => {
    const r = await sendEmail({ ...VALID, to: "not-an-email" });
    expect(r.delivered).toBe(false);
    expect(r.dryRun).toBe(false);
    expect(r.error).toMatch(/recipient/i);
  });

  it("rejects an invalid reply-to address without sending", async () => {
    const r = await sendEmail({ ...VALID, replyTo: "nope" });
    expect(r.delivered).toBe(false);
    expect(r.error).toMatch(/reply-to/i);
  });

  it("rejects an empty subject", async () => {
    const r = await sendEmail({ ...VALID, subject: "   " });
    expect(r.error).toMatch(/subject/i);
  });

  it("rejects an empty body", async () => {
    const r = await sendEmail({ ...VALID, html: "" });
    expect(r.error).toMatch(/body/i);
  });
});

describe("ResendProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the Resend API and returns the message id on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ResendProvider("re_live", "Acme <hi@acme.com>");
    const r = await provider.send(VALID);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(opts.headers.Authorization).toBe("Bearer re_live");
    const body = JSON.parse(opts.body);
    expect(body.from).toBe("Acme <hi@acme.com>");
    expect(body.to).toEqual(["person@example.com"]);
    expect(r).toEqual({ delivered: true, dryRun: false, id: "msg_123" });
  });

  it("returns a generic error (not the raw payload) on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ message: "secret internal detail" }),
      }),
    );
    const provider = new ResendProvider("re_live", "Acme <hi@acme.com>");
    const r = await provider.send(VALID);
    expect(r.delivered).toBe(false);
    expect(r.error).toBe("Email provider returned 422");
    expect(r.error).not.toContain("secret internal detail");
  });

  it("returns a generic error when the network throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const provider = new ResendProvider("re_live", "Acme <hi@acme.com>");
    const r = await provider.send(VALID);
    expect(r.delivered).toBe(false);
    expect(r.error).toBe("Email provider unreachable");
  });
});
