import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
const revision = process.env.COMMIT_REF || (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], {encoding:"utf8"}).trim(); } catch { return "local"; } })();
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(revision.slice(0, 7)) },
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: { outDir: "dist" },
});
