import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isRecurringTier } from "@/lib/billing/stripe";

/**
 * The legal disclosure at the purchase action must match what the customer is
 * actually charged.
 *
 * Apple 3.1.2 requires Terms-of-Use and privacy links where an auto-renewing
 * subscription is offered, and the wording has to be true: `apartment` is a
 * one-time $29 charge, so telling that buyer they are "subscribing" is a false
 * statement on a live checkout page.
 *
 * The page originally derived the verb from whether its own copy table happened
 * to carry a `renewalNote`. That is a second, independent signal — an edit to
 * the copy table could silently flip the disclosure without touching billing.
 * Both the Stripe checkout mode and the disclosure now read `isRecurringTier`,
 * so they cannot disagree; these tests pin that predicate and the page's use of
 * it.
 */

const repoRoot = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const UPGRADE_PAGE = "app/billing/upgrade/page.tsx";
const STRIPE_MODULE = "lib/billing/stripe.ts";

describe("isRecurringTier", () => {
  it("treats the one-time Apartment purchase as NOT recurring", () => {
    expect(isRecurringTier("apartment")).toBe(false);
  });

  it("treats both Pro plans as recurring", () => {
    expect(isRecurringTier("pro")).toBe(true);
    expect(isRecurringTier("pro_annual")).toBe(true);
  });
});

describe("Stripe checkout mode and the purchase disclosure agree", () => {
  it("checkout picks its mode from the same predicate the disclosure uses", () => {
    // If these ever read different signals again, the disclosure can claim a
    // subscription on a one-time charge (or vice versa) with every test green.
    const stripe = read(STRIPE_MODULE);
    expect(stripe).toMatch(/mode[^=]*=\s*isRecurringTier\(tier\)\s*\?\s*"subscription"\s*:\s*"payment"/);
    expect(read(UPGRADE_PAGE)).toContain("isRecurringTier(tier)");
  });

  it("the one-time tier says 'By purchasing' and the renewing tiers 'By subscribing'", () => {
    const page = read(UPGRADE_PAGE);
    // Pinned as a whole conditional so swapping the branches fails here.
    expect(page).toMatch(
      /isRecurringTier\(tier\)\s*\?\s*"By subscribing you agree to our "\s*:\s*"By purchasing you agree to our "/,
    );
  });

  it("links both the Terms of Use and the Privacy Policy at the purchase action", () => {
    // Apple 3.1.2 is about PROXIMITY — the footer linking them is not enough,
    // so assert both live in this page, not merely somewhere in the layout.
    const page = read(UPGRADE_PAGE);
    expect(page).toContain('href="/terms"');
    expect(page).toContain('href="/privacy"');
  });

  it("keeps the disclosure at a WCAG-AA-legible token, not an opacity-reduced one", () => {
    // `text-muted-foreground/70` at text-xs is #9a948d on the white card: 3.0:1
    // against a 4.5:1 AA requirement, a serious axe violation on a legally
    // required notice. This is the regression guard for that specific class.
    const page = read(UPGRADE_PAGE);
    const disclosure = /<p className="([^"]*)"[^>]*>\s*\{\/\* Reads from the same predicate/.exec(
      page,
    );
    expect(disclosure, "disclosure <p> not found — update this guard").not.toBeNull();
    expect(disclosure![1]).toContain("text-muted-foreground");
    expect(disclosure![1]).not.toMatch(/text-muted-foreground\/\d+/);
  });
});
