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
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  adminAvailable,
  createConfirmedUser,
  deleteUser,
  seedProEntitlement,
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

  /**
   * Run the axe gate on the currently-loaded page. Shared by both authed a11y
   * loops so the tag set, the critical/serious filter and the CI diagnostic
   * output can only ever be defined once.
   */
  async function expectNoA11yViolations(page: Page, label: string): Promise<void> {
    await expectNoErrorBoundary(page);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    if (criticalOrSerious.length > 0) {
      const summary = criticalOrSerious
        .map(
          (v) =>
            `[${v.impact}] ${v.id}: ${v.description}\n  ` +
            v.nodes.slice(0, 3).map((n) => n.html).join("\n  "),
        )
        .join("\n\n");
      console.error(`Authed accessibility violations on ${label}:\n${summary}`);
    }
    expect(criticalOrSerious, `axe violations on ${label}`).toHaveLength(0);
  }

  /**
   * Create a project + room through the app's OWN API from inside the signed-in
   * page, and return their ids.
   *
   * It has to go through the app rather than an admin/Postgres seed for the same
   * reason the money-path test documents: lib/supabase/server.ts proxies data ops
   * to the in-memory store and uses real Supabase only for auth, so a row written
   * out-of-band is invisible to the route that reads it.
   *
   * Throws with the failing stage + body so a CI failure names what broke instead
   * of surfacing later as an unexplained 404 on the route under test.
   */
  async function seedProjectAndRoom(
    page: Page,
    projectName: string,
  ): Promise<{ projectId: string; roomId: string }> {
    const result = await page.evaluate(async (name) => {
      async function postJson(path: string, payload: unknown) {
        const r = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        return { status: r.status, text: await r.text() };
      }
      const proj = await postJson("/api/projects", { name });
      if (proj.status !== 201) return { stage: "projects", ...proj };
      const projectId = JSON.parse(proj.text).id as string;
      const room = await postJson("/api/rooms", {
        project_id: projectId,
        name: "E2E Living Room",
        room_type: "living_room",
      });
      if (room.status !== 201) return { stage: "rooms", ...room };
      return { stage: "ok", projectId, roomId: JSON.parse(room.text).id as string };
    }, projectName);

    if (result.stage !== "ok") {
      throw new Error(
        `seedProjectAndRoom failed at ${result.stage}: ` +
          `${"status" in result ? result.status : "?"} ${"text" in result ? result.text : ""}`,
      );
    }
    return { projectId: result.projectId as string, roomId: result.roomId as string };
  }

  // Authed a11y GATE (design_taste): the public-page axe scan (e2e/a11y.spec.ts)
  // never reaches the signed-in surfaces. Scan the authed routes a fresh user can
  // reach WITHOUT seeding — dashboard (the primary home), account, the free-tier
  // /saved gate, and the paywall — and fail on any critical/serious WCAG 2 A/AA
  // violation. reducedMotion avoids confetti/animation churn so the scan is
  // deterministic.
  const AUTHED_A11Y_ROUTES = ["/dashboard", "/account", "/saved", "/billing/upgrade?tier=pro"];
  for (const route of AUTHED_A11Y_ROUTES) {
    test(`authed a11y: ${route} has no critical/serious axe violations`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signIn(page);
      await page.goto(route);
      await expectNoA11yViolations(page, route);
    });
  }

  // The four routes above are all LOW-density chrome. The design-dense surfaces —
  // where the layered layouts, image grids, tab switchers and comparison tables
  // live, and where contrast/label failures actually concentrate — sit behind a
  // project+room, so nothing was scanning them.
  //
  // SCOPE, stated honestly: a freshly-seeded room has no diagnosis, products or
  // mockups yet, so these scans cover each surface's page chrome and its EMPTY
  // state, not a fully-populated one. That is a real narrowing of the gap (the
  // empty state is a shipped state a user sees, and the persistent nav/header/tab
  // furniture is identical in both), NOT a full closure — scanning the populated
  // state additionally needs a diagnosis+sourcing fixture, which stays on the
  // tracked-gaps list in e2e/ROUTE_INVENTORY.md.
  const SEEDED_A11Y_SURFACES = ["focus", "diagnosis", "products", "mockups", "bundles", "compare"];
  for (const surface of SEEDED_A11Y_SURFACES) {
    test(`authed a11y: seeded room ${surface} has no critical/serious axe violations`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signIn(page);
      const { projectId, roomId } = await seedProjectAndRoom(page, `E2E A11y ${surface}`);
      const route = `/projects/${projectId}/rooms/${roomId}/${surface}`;
      await page.goto(route);
      // Label by SURFACE, not the full path: the ids are per-run, and a stable
      // label keeps a CI failure greppable across runs.
      await expectNoA11yViolations(page, `seeded room /${surface}`);
    });
  }

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
    await signIn(page); // establishes the signed-in Supabase session in the page

    // Seed the project + room through the app's OWN API, from inside the page
    // (browser fetch, credentials:"include"), so they live in the SAME data
    // layer the mockups route reads. lib/supabase/server.ts's createClient()
    // proxies all data ops to the in-memory store and uses real Supabase only
    // for auth — so an admin/Postgres seed is invisible to the route; the room
    // must be created through the app itself. All three POSTs run in the page's
    // authenticated context, exactly as the app calls its own API.
    const result = await page.evaluate(async () => {
      async function postJson(path: string, payload: unknown) {
        const r = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        return { status: r.status, text: await r.text() };
      }
      const proj = await postJson("/api/projects", { name: "E2E Money-Path Project" });
      if (proj.status !== 201) return { stage: "projects", ...proj };
      const projectId = JSON.parse(proj.text).id as string;
      const room = await postJson("/api/rooms", {
        project_id: projectId,
        name: "E2E Living Room",
        room_type: "living_room",
      });
      if (room.status !== 201) return { stage: "rooms", ...room };
      const roomId = JSON.parse(room.text).id as string;
      const mockup = await postJson("/api/mockups", {
        room_id: roomId,
        recommendation_mockup: {
          category: "accent_chair",
          search_title: "Cognac leather accent chair",
          specs: "Full-grain leather, walnut legs, 30in wide",
        },
      });
      return { stage: "mockups", ...mockup };
    });
    expect(
      result.status,
      `money-path failed at ${result.stage}: ${result.status} ${result.text}`,
    ).toBe(200);
    const body = JSON.parse(result.text);
    expect(body.recommendation_mockup).toBe(true);
    const imageUrl: unknown = body.image_url;
    expect(typeof imageUrl === "string" && imageUrl.length > 0, "no image_url returned").toBe(true);

    // Resolve the rendered image bytes across the possible return shapes:
    //  - `data:image/png;base64,…`  → decode inline (upload-failure fallback)
    //  - `/uploads/…`               → the memory store's storage writes the PNG
    //    under public/uploads and returns a RELATIVE url; `next start` does not
    //    serve runtime-written public/ files over HTTP, so read the committed
    //    bytes straight from disk (the test shares the runner with the app),
    //    mirroring how lib/ai/gemini.ts resolves `/uploads/` paths.
    //  - absolute URL              → fetch it (real object storage).
    let bytes: Buffer;
    const url = imageUrl as string;
    if (url.startsWith("data:")) {
      bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    } else if (url.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), "public", url);
      expect(fs.existsSync(filePath), `rendered image missing on disk: ${filePath}`).toBe(true);
      bytes = fs.readFileSync(filePath);
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
