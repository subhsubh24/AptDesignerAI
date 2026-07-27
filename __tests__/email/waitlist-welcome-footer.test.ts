import { afterEach, describe, expect, it } from "vitest";
import { buildWaitlistWelcomeEmail } from "@/lib/email/templates/waitlist-welcome";

const WAITLIST_ID = "9c6f4e2a-1b3d-4a7e-9c0a-2f8e6d1b5a3c";

// waitlist_welcome_1 is classified as a marketing stage (lib/email/index.ts
// TRANSACTIONAL_STAGES excludes it), so it must carry a WORKING unsubscribe
// link and, once configured, the physical address. Unlike lifecycle.ts's
// marketing footer, this canNOT point at /account: a waitlist_emails
// subscriber never gets a Supabase auth account, so /account would just
// bounce them to a login wall (GTM Auditor Run 4 compliance finding,
// confirmed by an independent Run 15 review). It must link to the public,
// no-login app/api/waitlist/unsubscribe endpoint, keyed by the row's own id.
describe("waitlist-welcome template CAN-SPAM footer", () => {
  const orig = process.env.EMAIL_PHYSICAL_ADDRESS;
  afterEach(() => {
    if (orig === undefined) delete process.env.EMAIL_PHYSICAL_ADDRESS;
    else process.env.EMAIL_PHYSICAL_ADDRESS = orig;
  });

  it("renders a no-login unsubscribe link keyed by the waitlist row id, not /account", () => {
    delete process.env.EMAIL_PHYSICAL_ADDRESS;
    const { html, text } = buildWaitlistWelcomeEmail("https://aptdesignerai.com", WAITLIST_ID);
    const expectedUrl = `https://aptdesignerai.com/api/waitlist/unsubscribe?id=${WAITLIST_ID}`;
    expect(html).toContain(expectedUrl);
    expect(text).toContain(expectedUrl);
    expect(html).not.toContain("/account");
    expect(text).not.toContain("/account");
  });

  it("omits the address line when EMAIL_PHYSICAL_ADDRESS is unset", () => {
    delete process.env.EMAIL_PHYSICAL_ADDRESS;
    const { html, text } = buildWaitlistWelcomeEmail("https://aptdesignerai.com", WAITLIST_ID);
    expect(html).not.toMatch(/123 Main St/);
    expect(text).not.toMatch(/123 Main St/);
  });

  it("renders the real address in both html and text once set", () => {
    process.env.EMAIL_PHYSICAL_ADDRESS = "123 Main St, Springfield, ST 00000";
    const { html, text } = buildWaitlistWelcomeEmail("https://aptdesignerai.com", WAITLIST_ID);
    expect(html).toContain("123 Main St, Springfield, ST 00000");
    expect(text).toContain("123 Main St, Springfield, ST 00000");
  });
});
