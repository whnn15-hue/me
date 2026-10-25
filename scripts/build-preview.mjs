import { build } from 'vite';
// Explicitly erase cloud configuration, including any .env files on the machine.
const values = { VITE_PREVIEW_MODE: 'true', VITE_CLOUD_MODE: 'false', VITE_DEPLOYMENT_MODE: 'free', VITE_API_ORIGIN: '',
  VITE_OWNER_EMAIL: '', VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_PROJECT_ID: '', VITE_FIREBASE_AUTH_DOMAIN: '', VITE_FIREBASE_STORAGE_BUCKET: '', VITE_FIREBASE_APP_ID: '' };
await build({ mode: 'preview', envPrefix: '__PREVIEW_NO_PUBLIC_ENV__',
  define: Object.fromEntries(Object.entries(values).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
  build: { outDir: '.preview-dist', emptyOutDir: true } });
