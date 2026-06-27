import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// In CI the browser is pre-installed at a fixed path; locally (or anywhere that
// path is absent) fall back to Playwright's managed browser so the suite ACTUALLY
// RUNS off-CI. A suite that only runs on CI is the "builds but won't run" failure
// the BUILDS != WORKS guard exists to prevent.
const CI_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ciExecutablePath = existsSync(CI_CHROME) ? CI_CHROME : undefined;

// Use a DEDICATED port locally, not Next's default 3000. Another app on :3000
// (e.g. a sibling product's dev server) + reuseExistingServer would make the
// suite silently test the WRONG app — a real trap. CI sets PLAYWRIGHT_BASE_URL.
const LOCAL_PORT = 3100;
const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? LOCAL_URL,
    trace: "on-first-retry",
    ...(ciExecutablePath ? { launchOptions: { executablePath: ciExecutablePath } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Start the dev server if not already running in CI (CI pre-starts it)
  webServer: process.env.CI
    ? undefined
    : {
        command: `npm run dev -- -p ${LOCAL_PORT}`,
        url: LOCAL_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
