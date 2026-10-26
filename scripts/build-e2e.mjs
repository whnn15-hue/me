import { build } from 'vite';

// Keep real deployment settings and artifacts out of local browser verification.
const values = {
  VITE_PREVIEW_MODE: 'false',
  VITE_CLOUD_MODE: 'false', VITE_DEPLOYMENT_MODE: 'free', VITE_API_ORIGIN: '',
  VITE_OWNER_EMAIL: '', VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_PROJECT_ID: '',
  VITE_FIREBASE_AUTH_DOMAIN: '', VITE_FIREBASE_STORAGE_BUCKET: '', VITE_FIREBASE_APP_ID: '',
};
await build({
  mode: 'test',
  define: Object.fromEntries(Object.entries(values).map(([name, value]) => [`import.meta.env.${name}`, JSON.stringify(value)])),
  envPrefix: '__E2E_NO_PUBLIC_ENV__',
  build: { outDir: '.e2e-dist', emptyOutDir: true },
});
