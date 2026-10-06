import { defineConfig, devices } from "@playwright/test";
const externalOrigin = process.env.PLAYWRIGHT_BASE_URL;
if (externalOrigin && new URL(externalOrigin).origin !== externalOrigin)
  throw new Error("PLAYWRIGHT_BASE_URL must be an origin without a path");
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  webServer: externalOrigin
    ? undefined
    : {
        command: "node scripts/e2e-start.mjs",
        url: "http://localhost:3002/v1/health",
        reuseExistingServer: false,
        timeout: 120000,
      },
  timeout: externalOrigin ? 180000 : 90000,
  expect: { timeout: externalOrigin ? 30000 : 20000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: externalOrigin ?? "http://localhost:3002",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
  reporter: [["list"], ["html", { open: "never" }]],
});
