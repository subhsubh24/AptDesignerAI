import { test, expect } from "@playwright/test";

// These pages must load for unauthenticated visitors.
// They render entirely from static/server markup — no Supabase or AI calls.
// Each `heading` is the page's OWN h1 text.
//
// Three of these were RED, in two different ways, and it is worth being exact
// about which because they argue for different things:
//   - /support matched THREE headings at once (h1 "How can we help?", an h2
//     "Email support", a footer h3 "Support") — a strict-mode violation. The
//     `level: 1` scoping below fixes that, and is the stronger assertion anyway:
//     the page's own title rather than any matching text anywhere on it.
//   - /faq and /guides matched NOTHING. They expected /faq|frequently/ and
//     /guide/, but those h1s read "Questions, answered" and "Design, explained"
//     and always have — the regexes were wrong in the spec's first commit, so
//     neither test has ever passed. Not a page that rotted away from its test;
//     a test that was never right.
// Both failure modes survived because nothing runs this file (see below).
const PUBLIC_PAGES = [
  { path: "/waitlist", heading: /coming to your phone/i },
  { path: "/pricing", heading: /honest pricing/i },
  { path: "/faq", heading: /questions, answered/i },
  { path: "/privacy", heading: /privacy/i },
  { path: "/terms", heading: /terms/i },
  { path: "/guides", heading: /design, explained/i },
  { path: "/support", heading: /how can we help/i },
];

for (const { path, heading } of PUBLIC_PAGES) {
  test(`${path} loads and has a visible heading`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(400);
    // `level: 1` is load-bearing, not tidiness: unscoped, this matches every
    // heading on the page, which is how /support resolved to three elements at
    // once. Scoping to the h1 asserts the page's OWN title — the same reason
    // journeys.spec.ts pins each route to its h1.
    //
    // Nothing runs this file, which is why the breakage above went unnoticed:
    // the CI `journeys` job (.github/workflows/ci.yml) invokes
    // `scripts/run-journeys.sh`, which runs e2e/journeys.spec.ts and nothing
    // else, so this spec and e2e/a11y.spec.ts never execute there.
    //
    // Pinning to the h1 is also the stronger assertion: it checks the page's
    // OWN title rather than accepting any matching text anywhere on it — the
    // same reason journeys.spec.ts asserts each route's own h1.
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  });
}

test("the waitlist CTA is live on arrival, and an empty submit says why", async ({ page }) => {
  // The waitlist is the pre-launch conversion surface, so its submit button is
  // the single most load-bearing control on the public site. It used to render
  // `disabled` until the email field was non-empty, which meant a visitor's
  // first sight of the primary action was a greyed-out button on a page headed
  // "Coming soon" — indistinguishable from a feature that is not built yet —
  // and, because a disabled button leaves the tab order, a keyboard user found
  // nothing after the input.
  //
  // Asserting ENABLED rather than merely visible is the whole point: the
  // journey suite already checks this button is visible, and a visible disabled
  // button passes that.
  await page.goto("/waitlist");
  const submit = page.getByRole("button", { name: /notify me/i });
  await expect(submit).toBeEnabled();

  // Live must not mean silent. Clicking with an empty field has to produce a
  // visible reason — here the browser's own constraint validation, which the
  // `required` input gives us for free and which also focuses the field.
  const email = page.getByLabel(/email address/i);
  await submit.click();
  expect(await email.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
  expect(await email.evaluate((el: HTMLInputElement) => el.validationMessage)).not.toBe("");

  // And a real address clears it, so the guard above cannot pass by the field
  // being permanently invalid.
  await email.fill("journey-waitlist@example.com");
  expect(await email.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(true);
  await expect(submit).toBeEnabled();
});

test("root / redirects to /dashboard or /login", async ({ page }) => {
  const response = await page.goto("/");
  // Should redirect, not 404 or 500
  expect(response?.status()).toBeLessThan(400);
  const url = page.url();
  expect(url).toMatch(/\/(dashboard|login)/);
});
