/**
 * Runtime functional JOURNEY suite — proves the app WORKS for a user, not just
 * that it builds. Every test asserts an INTENDED OUTCOME (real signed-in content,
 * a real redirect, the absence of the error boundary) — never just status < 400.
 *
 * The canonical guard: after signing in, the dashboard must render its real,
 * populated home — NOT the "Something went wrong" error boundary (the
 * "account → dashboard not available" failure class).
 *
 * Two tiers:
 *  - PUBLIC + STRUCTURAL — no auth backend needed; run anywhere (local or CI).
 *  - AUTHENTICATED — self-seed a confirmed user via the admin client, then sign
 *    in through the real UI. Gated on E2E_AUTH_STACK + service-role env so the
 *    suite still runs (public/structural) where no auth backend exists.
 *
 * See e2e/ROUTE_INVENTORY.md for full coverage + the tracked gaps.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  adminAvailable,
  createConfirmedUser,
  deleteUser,
  uniqueEmail,
} from "./helpers/seed";

// Rendered by app/error.tsx + app/global-error.tsx. A healthy screen NEVER shows it.
const BOUNDARY_TEXT = /something went wrong/i;

async function expectNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText(BOUNDARY_TEXT)).toHaveCount(0);
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC + STRUCTURAL — no auth backend required.
// ───────────────────────────────────────────────────────────────────────────
test.describe("public + structural journeys", () => {
  test("signup page renders the real form, not an error screen", async ({ page }) => {
    await page.goto("/signup");
    await expectNoErrorBoundary(page);
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  });

  test("login page renders the real form", async ({ page }) => {
    await page.goto("/login");
    await expectNoErrorBoundary(page);
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  for (const path of ["/dashboard", "/account", "/saved"]) {
    test(`protected route ${path} bounces a logged-out visitor to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expectNoErrorBoundary(page);
    });
  }

  test("root / resolves to a real screen (login when logged out)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/(login|dashboard)/);
    await expectNoErrorBoundary(page);
  });

  test("pricing page shows real content, not an error", async ({ page }) => {
    const res = await page.goto("/pricing");
    expect(res?.status() ?? 0).toBeLessThan(400);
    await expectNoErrorBoundary(page);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AUTHENTICATED — needs a seeded auth backend (Supabase-local in CI).
// ───────────────────────────────────────────────────────────────────────────
test.describe("authenticated journeys", () => {
  test.skip(
    !process.env.E2E_AUTH_STACK || !adminAvailable(),
    "needs a seeded auth backend: set E2E_AUTH_STACK=1 with Supabase-local service-role env (see e2e/ROUTE_INVENTORY.md)",
  );

  const PASSWORD = "E2e-test-pass-123";
  let userId: string | undefined;
  let email: string;

  test.beforeEach(async () => {
    email = uniqueEmail();
    userId = await createConfirmedUser(email, PASSWORD);
  });
  test.afterEach(async () => {
    if (userId) await deleteUser(userId);
    userId = undefined;
  });

  async function signIn(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  }

  test("sign-in lands on a WORKING, populated dashboard (not 'not available')", async ({ page }) => {
    await signIn(page);
    await expectNoErrorBoundary(page);
    // Signed-in-only content proves the screen actually rendered:
    await expect(page.getByRole("heading", { name: /welcome to aptdesigner/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /start designing/i })).toBeVisible();
  });

  test("core product flow entry: onboarding starts without error", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: /start designing/i }).click();
    await expectNoErrorBoundary(page);
  });

  test("logged-in visitor hitting /login is redirected to the dashboard", async ({ page }) => {
    await signIn(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("account/settings screen renders for a signed-in user", async ({ page }) => {
    await signIn(page);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account/);
    await expectNoErrorBoundary(page);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  test("paywall: pricing → upgrade renders a real checkout entry (Stripe test mode)", async ({ page }) => {
    await signIn(page);
    await page.goto("/billing/upgrade?tier=pro");
    await expect(page).toHaveURL(/\/billing\/upgrade/);
    await expectNoErrorBoundary(page);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
});
