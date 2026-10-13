import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["--watch", "server/index.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "3001",
      APP_LOCAL_MODE: "true",
      APP_URL: "http://127.0.0.1:5173",
    },
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
  }),
];
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
for (const child of children)
  child.on("exit", (code) => {
    stop();
    process.exit(code ?? 1);
  });
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
