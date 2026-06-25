import { test, expect } from "@playwright/test";

// These pages must load for unauthenticated visitors.
// They render entirely from static/server markup — no Supabase or AI calls.
const PUBLIC_PAGES = [
  { path: "/waitlist", heading: /coming to your phone/i },
  { path: "/pricing", heading: /pricing|plans|choose/i },
  { path: "/faq", heading: /faq|frequently/i },
  { path: "/privacy", heading: /privacy/i },
  { path: "/terms", heading: /terms/i },
  { path: "/guides", heading: /guide/i },
  { path: "/support", heading: /support|help/i },
];

for (const { path, heading } of PUBLIC_PAGES) {
  test(`${path} loads and has a visible heading`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  });
}

test("root / redirects to /dashboard or /login", async ({ page }) => {
  const response = await page.goto("/");
  // Should redirect, not 404 or 500
  expect(response?.status()).toBeLessThan(400);
  const url = page.url();
  expect(url).toMatch(/\/(dashboard|login)/);
});
