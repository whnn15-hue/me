import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test", outputDir: ".preview-test-results", testMatch: "reuse-preview.spec.ts", workers: 1, timeout: 120000, retries: 0, reporter: "list",
  use: { actionTimeout: 15000, baseURL: "http://127.0.0.1:4173", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] } },
  webServer: { command: "npm run build:preview && npx vite preview --host 127.0.0.1 --port 4173 --outDir .preview-dist", url: "http://127.0.0.1:4173", reuseExistingServer: false, timeout: 60000 },
});
