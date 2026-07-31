import { test, expect } from "@playwright/test";

// These pages must load for unauthenticated visitors.
// They render entirely from static/server markup — no Supabase or AI calls.
// Each `heading` is the page's OWN h1 text. /faq and /guides used to expect
// /faq|frequently/ and /guide/, which their h1s ("Questions, answered" and
// "Design, explained") do not contain — those two tests were passing on a
// footer or nav heading elsewhere on the page, so they would have gone on
// passing with the entire article content deleted. Matching the real h1 is what
// makes the assertion capable of failing.
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
    // `level: 1` is load-bearing, not tidiness. Unscoped, this matched every
    // heading on the page, and /faq, /guides and /support each grew a section
    // heading or a footer column that also matches — three strict-mode
    // violations ("resolved to 3 elements"), i.e. three tests RED. They stayed
    // red unnoticed because nothing runs this file: the CI `journeys` job
    // (.github/workflows/ci.yml) invokes `scripts/run-journeys.sh`, which runs
    // e2e/journeys.spec.ts and nothing else, so this spec and e2e/a11y.spec.ts
    // are never executed there.
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
