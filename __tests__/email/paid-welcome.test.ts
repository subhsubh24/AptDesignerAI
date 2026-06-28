import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildPaidWelcomeEmail1 } from "@/lib/email/templates/lifecycle";
import { sendEmail } from "@/lib/email";

// The conversion-moment "welcome to Pro" email fires from the billing webhook on
// a genuine free->paid activation. These assert the template renders correctly
// and that the `paid_welcome_1` stage is wired end-to-end through sendEmail.
describe("buildPaidWelcomeEmail1", () => {
  it("interpolates the site URL into the dashboard CTA and renders all parts", () => {
    const email = buildPaidWelcomeEmail1("https://aptdesignerai.ai");
    expect(email.subject).toMatch(/Pro/i);
    expect(email.html).toContain("https://aptdesignerai.ai/dashboard");
    expect(email.html).toContain("https://aptdesignerai.ai/account"); // manage-prefs link
    expect(email.html.length).toBeGreaterThan(0);
    expect(email.text).toContain("https://aptdesignerai.ai/dashboard");
    // Caller passes a normalized (no trailing slash) URL — confirm no double slash.
    expect(email.html).not.toContain("ai//");
    // Conversion-moment copy should confirm the upgrade, not nag.
    expect(email.text.toLowerCase()).toContain("active");
  });
});

describe("paid_welcome_1 stage through sendEmail (dry-run)", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.GROWTH_EMAIL_DRY_RUN;
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  it("accepts the new stage and dry-run-sends it", async () => {
    const { subject, html, text } = buildPaidWelcomeEmail1("https://aptdesignerai.ai");
    const r = await sendEmail({ to: "new@example.com", subject, html, text, stage: "paid_welcome_1" });
    expect(r.dryRun).toBe(true);
    expect(r.delivered).toBe(false);
    expect(r.id).toBe("dryrun:paid_welcome_1");
  });
});
