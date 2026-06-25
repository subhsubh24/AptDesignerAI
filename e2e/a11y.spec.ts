import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Public pages that must be accessible to unauthenticated visitors.
// Each must have no critical or serious axe violations.
const PUBLIC_PAGES = [
  "/waitlist",
  "/pricing",
  "/faq",
  "/privacy",
  "/terms",
  "/guides",
  "/support",
];

for (const path of PUBLIC_PAGES) {
  test(`${path} has no critical/serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    // Wait for the page to settle — fonts, images, interactive components
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );

    if (criticalOrSerious.length > 0) {
      const summary = criticalOrSerious
        .map(
          (v) =>
            `[${v.impact}] ${v.id}: ${v.description}\n  ` +
            v.nodes
              .slice(0, 3)
              .map((n) => n.html)
              .join("\n  ")
        )
        .join("\n\n");
      expect.soft(criticalOrSerious).toHaveLength(0);
      console.error(`Accessibility violations on ${path}:\n${summary}`);
    }

    expect(criticalOrSerious).toHaveLength(0);
  });
}
