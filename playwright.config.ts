import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  webServer: {
    command: "node scripts/e2e-start.mjs",
    url: "http://localhost:3002/v1/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
  timeout: 90000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:3002",
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
