import { describe, expect, it } from "vitest";
import {
  buildActivationEmail2,
  buildActivationEmail3,
  buildHabitEmail1,
  buildHabitEmail2,
  buildHabitEmail3,
  buildWinBackEmail1,
  buildWinBackEmail2,
  buildWinBackEmail3,
} from "@/lib/email/templates/lifecycle";

// APT-26: the 8 lifecycle.ts email-builders below (activation_2/3, habit_1/2/3,
// winback_1/2/3) had zero direct behavior coverage — only buildPaidWelcomeEmail1
// (__tests__/email/paid-welcome.test.ts) and the shared CAN-SPAM footer helper
// (__tests__/email/lifecycle-footer.test.ts, via buildActivationEmail1) were
// tested. Each test below asserts subject + the siteUrl-derived CTA path, and
// where a sequence has more than one stage, that the LATER stage's CTA/copy is
// materially different from the earlier one — not just escalating tone.

const SITE = "https://aptdesignerai.com";

describe("buildActivationEmail2", () => {
  it("renders subject + dashboard CTA + no double slash", () => {
    const email = buildActivationEmail2(SITE);
    expect(email.subject).toMatch(/room that bothers you/i);
    expect(email.html).toContain(`${SITE}/dashboard`);
    expect(email.html).toContain(`${SITE}/account`); // manage-prefs footer link
    expect(email.text).toContain(`${SITE}/dashboard`);
    expect(email.html).not.toContain("com//");
  });
});

describe("buildActivationEmail3", () => {
  it("renders subject + dashboard CTA + a support link distinct from activation_2", () => {
    const email = buildActivationEmail3(SITE);
    expect(email.subject).toMatch(/before we stop/i);
    expect(email.html).toContain(`${SITE}/dashboard`);
    expect(email.html).toContain(`${SITE}/support`); // final-nudge support link, unique to this stage
    expect(email.html).not.toContain("com//");
  });
});

describe("buildHabitEmail1", () => {
  it("renders subject + dashboard CTA and explains the analysis results", () => {
    const email = buildHabitEmail1(SITE);
    expect(email.subject).toMatch(/what the analysis found/i);
    expect(email.html).toContain(`${SITE}/dashboard`);
    expect(email.text.toLowerCase()).toContain("design direction");
    expect(email.html).not.toContain("com//");
  });
});

describe("buildHabitEmail2", () => {
  it("renders subject + dashboard CTA and covers the material-story angle", () => {
    const email = buildHabitEmail2(SITE);
    expect(email.subject).toMatch(/material story/i);
    expect(email.html).toContain(`${SITE}/dashboard`);
    expect(email.text.toLowerCase()).toContain("material");
    expect(email.html).not.toContain("com//");
  });
});

describe("buildHabitEmail3", () => {
  it("renders subject + a pricing CTA distinct from habit_1/habit_2's dashboard CTA", () => {
    const email = buildHabitEmail3(SITE);
    expect(email.subject).toMatch(/cross-room problem/i);
    // The habit sequence escalates toward conversion: 1 and 2 point at the
    // dashboard (keep using the free tier), 3 points at pricing (upgrade ask).
    expect(email.html).toContain(`${SITE}/pricing`);
    expect(email.html).not.toContain(`${SITE}/dashboard`);
    expect(email.html).not.toContain("com//");
  });
});

describe("buildWinBackEmail1", () => {
  it("renders subject + account CTA (no upgrade link yet, this is the neutral notice)", () => {
    const email = buildWinBackEmail1(SITE);
    expect(email.subject).toMatch(/subscription has ended/i);
    expect(email.html).toContain(`${SITE}/account`);
    expect(email.html).not.toContain(`${SITE}/billing/upgrade`);
    expect(email.html).not.toContain("com//");
  });
});

describe("buildWinBackEmail2", () => {
  it("renders subject + a billing/upgrade CTA distinct from winback_1's account CTA", () => {
    const email = buildWinBackEmail2(SITE);
    expect(email.subject).toMatch(/still here/i);
    expect(email.html).toContain(`${SITE}/billing/upgrade`);
    expect(email.html).not.toContain("com//");
  });
});

describe("buildWinBackEmail3", () => {
  it("renders subject + dashboard CTA (final touch, back to the free-tier door)", () => {
    const email = buildWinBackEmail3(SITE);
    expect(email.subject).toMatch(/last check-in/i);
    expect(email.html).toContain(`${SITE}/dashboard`);
    expect(email.html).not.toContain("com//");
  });
});
