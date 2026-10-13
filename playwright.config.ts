import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3002",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command:
      'node scripts/build-e2e.mjs && APP_STATIC_DIR=.e2e-dist APP_LOCAL_MODE=true APP_URL=http://127.0.0.1:3002 APP_DATA_DIR="$(mktemp -d /tmp/career-e2e.XXXXXX)" PORT=3002 node server/index.mjs',
    url: "http://127.0.0.1:3002/api/status",
    env: {
      APP_AI_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      OWNER_EMAIL: "",
      APP_ENCRYPTION_KEY: "",
    },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
