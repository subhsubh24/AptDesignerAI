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
  seedProEntitlement,
  seedRoom,
  uniqueEmail,
} from "./helpers/seed";

/** The 8-byte PNG signature — the money-path render must return REAL image bytes. */
const PNG_MAGIC_HEX = "89504e470d0a1a0a";

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
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    try {
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 8000 });
    } catch {
      // DIAGNOSTIC: surface WHY sign-in didn't navigate (the rendered auth error +
      // any console/network errors), so failures are debuggable from the CI log.
      const loginError = (
        await page.locator(".text-destructive").allTextContents().catch(() => [])
      ).join(" | ");
      throw new Error(
        `[DIAG] sign-in stayed at ${page.url()} | rendered-auth-error="${loginError}" | ` +
          `console=${JSON.stringify(consoleErrors.slice(0, 8))}`,
      );
    }
  }

  test("sign-in lands on a WORKING, populated dashboard (not 'not available')", async ({ page }) => {
    await signIn(page);
    await expectNoErrorBoundary(page);
    // Signed-in-only content proves the screen actually rendered:
    await expect(page.getByRole("heading", { name: /welcome to aptdesigner/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /start designing/i })).toBeVisible();
  });

  test("REAL UI signup creates a usable account and lands on the dashboard (no email verification)", async ({
    page,
  }) => {
    // Proves the no-email-verification fix end to end: a brand-new user filling
    // the signup form must reach the WORKING dashboard — never the removed
    // "check your email" dead-end (the verification loop that didn't exist).
    const freshEmail = uniqueEmail("ui-signup");
    await page.goto("/signup");
    await page.locator("#name").fill("E2E Tester");
    await page.locator("#email").fill(freshEmail);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await expectNoErrorBoundary(page);
    await expect(page.getByText(/check your email/i)).toHaveCount(0);
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

  test("paywall: /billing/upgrade renders a REAL Stripe checkout entry", async ({ page }) => {
    await signIn(page);
    await page.goto("/billing/upgrade?tier=pro");
    await expect(page).toHaveURL(/\/billing\/upgrade/);
    await expectNoErrorBoundary(page);
    // The real checkout entry — not just "a heading exists". Clicking this button
    // POSTs to /api/billing/checkout to create a Stripe Checkout Session.
    await expect(
      page.getByRole("button", { name: /continue to checkout/i }),
    ).toBeVisible();
  });

  test("paywall GATE: a free-tier user sees the upgrade CTA on /saved", async ({ page }) => {
    await signIn(page);
    await page.goto("/saved");
    await expectNoErrorBoundary(page);
    // The free-tier upgrade surface (UpgradeCtaCard) renders ONLY when the server
    // reports hasPaid === false — i.e. the paywall gate is actually live, not a
    // client-trusted flag. A brand-new user (0 saves) is on the free tier.
    await expect(
      page.getByRole("heading", {
        name: /unlock unlimited designs|reached your free save limit/i,
      }),
    ).toBeVisible();
  });

  test("paywall UNLOCK: a seeded Pro entitlement removes the free-tier upgrade CTA", async ({
    page,
  }) => {
    // Seed the stripe_customers row the Stripe webhook writes on a real purchase,
    // then prove the ENTITLEMENT UNLOCK is reflected end to end — WITHOUT a live
    // Stripe checkout. This is the paywall→unlock money-path outcome, asserted at
    // both the entitlement API and the rendered UI.
    await seedProEntitlement(userId!);
    await signIn(page);
    const statusPromise = page.waitForResponse(
      (r) => r.url().includes("/api/billing/status"),
      { timeout: 15_000 },
    );
    await page.goto("/saved");
    const status = await statusPromise;
    // The entitlement gate must report the seeded user as paid (real unlock).
    expect((await status.json()).hasPaid).toBe(true);
    await expectNoErrorBoundary(page);
    // …and the free-tier upgrade surface must NOT render for an entitled user.
    await expect(
      page.getByRole("heading", {
        name: /unlock unlimited designs|reached your free save limit/i,
      }),
    ).toHaveCount(0);
  });

  test("core money-path: POST /api/mockups renders a REAL, decodable image", async ({ page }) => {
    // THE convergence assertion — the AI design→render money path returns a REAL
    // image end to end, not a stub/TODO/500. Under E2E_AUTH_STACK the served
    // app's Gemini image call is answered by the hermetic cassette (a real 1×1
    // PNG), so this runs WITHOUT live LLM keys yet exercises the ACTUAL route:
    // auth → ownership → agent-run → generateMockupImage → image extraction →
    // storage-upload (or data-URI fallback) → JSON response. A placeholder
    // string, empty body, or error status all FAIL this test.
    const roomId = await seedRoom(userId!);
    await signIn(page); // establishes the Supabase auth cookie on the shared context

    // page.request shares the browser context's cookies, so this authed POST
    // carries the session the UI sign-in just established.
    const res = await page.request.post("/api/mockups", {
      data: {
        room_id: roomId,
        recommendation_mockup: {
          category: "accent_chair",
          search_title: "Cognac leather accent chair",
          specs: "Full-grain leather, walnut legs, 30in wide",
        },
      },
    });
    expect(
      res.status(),
      `mockups POST did not return 200: ${await res.text().catch(() => "<no body>")}`,
    ).toBe(200);
    const body = await res.json();
    expect(body.recommendation_mockup).toBe(true);
    const imageUrl: unknown = body.image_url;
    expect(typeof imageUrl === "string" && imageUrl.length > 0, "no image_url returned").toBe(true);

    // Resolve the image bytes whether the route returned a storage URL or the
    // data-URI fallback (Supabase-local may lack the room-images storage bucket,
    // in which case uploadMockupImage returns a `data:image/png;base64,…` URI).
    let bytes: Buffer;
    const url = imageUrl as string;
    if (url.startsWith("data:")) {
      bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    } else {
      const imgRes = await page.request.get(url);
      expect(imgRes.status(), `image URL ${url} not fetchable`).toBe(200);
      bytes = Buffer.from(await imgRes.body());
    }

    // A REAL PNG: 8-byte signature + a non-zero IHDR width/height (parsed from
    // the header). This is the functional-reality assertion with teeth — a
    // truncated/placeholder body cannot satisfy both the magic and the dims.
    expect(bytes.length).toBeGreaterThan(24);
    expect(bytes.subarray(0, 8).toString("hex")).toBe(PNG_MAGIC_HEX);
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(0); // IHDR width
    expect(bytes.readUInt32BE(20)).toBeGreaterThan(0); // IHDR height
  });
});
