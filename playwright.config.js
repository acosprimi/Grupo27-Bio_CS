import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.BASE_URL || "http://127.0.0.1:3000", browserName: "chromium", headless: true, trace: "retain-on-failure" },
  webServer: process.env.BASE_URL ? undefined : {
    command: "npm start",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
