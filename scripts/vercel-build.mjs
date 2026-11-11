// Vercel build entry. Production builds the real app into dist/. Every other
// Vercel environment (preview branches, pull requests) builds the isolated
// preview app into the same dist/ folder, with all cloud configuration erased.
// The API functions refuse non-production requests as a second safeguard.
import { spawnSync } from 'node:child_process';
const production = process.env.VERCEL_ENV === 'production';
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
console.log(`[vercel-build] ${production ? 'production app' : 'isolated preview app'} (VERCEL_ENV=${process.env.VERCEL_ENV || 'unset'})`);
if (production) run('npm', ['run', 'build'], { VITE_CLOUD_MODE: 'true', VITE_DEPLOYMENT_MODE: 'free', VITE_PREVIEW_MODE: 'false' });
else { run('npx', ['tsc', '-b']); run('node', ['scripts/build-preview.mjs'], { PREVIEW_OUT_DIR: 'dist' }); }
