import { getStore } from '@netlify/blobs';
import { createPrivateVault } from './vault.mjs';
import { createFreeApi } from './api.mjs';
import { createFreeAuth } from './auth.mjs';
import { networkFetch } from '../auth.mjs';
import { budgetedFetch } from './deadline.mjs';

function lazyVault(factory) {
  let current;
  const ready = () => current ||= Promise.resolve().then(factory).catch(error => { current = undefined; throw error; });
  return Object.fromEntries(['getJSON', 'setJSON', 'deleteJSON', 'consumeJSON', 'acquireLease'].map(method => [method, async (...args) => (await ready())[method](...args)]));
}
// Netlify injects the Blobs context for each invocation. A Store captures that
// context at creation, so it must not be cached across invocations. Only the
// public Google signing-key verifier is shared between requests.
export function createFreeRuntime({ env = process.env, storeFactory = getStore, vaultFactory = createPrivateVault, apiFactory = createFreeApi, authFactory = createFreeAuth, fetcher = networkFetch } = {}) {
  let authentication, authenticationConfig;
  return async () => {
    const aiEnabled = env.APP_AI_ENABLED === 'true'; const driveEnabled = env.APP_DRIVE_ENABLED === 'true';
    const config = { appUrl: String(env.APP_URL || '').replace(/\/$/, ''), ownerEmail: String(env.OWNER_EMAIL || '').trim().toLowerCase(), projectId: String(env.APP_FIREBASE_PROJECT_ID || '').trim(), firebaseWebApiKey: String(env.APP_FIREBASE_WEB_API_KEY || '').trim(), driveEnabled, googleClientId: driveEnabled ? env.GOOGLE_CLIENT_ID || '' : '', googleClientSecret: driveEnabled ? env.GOOGLE_CLIENT_SECRET || '' : '', aiEnabled, geminiKey: aiEnabled ? env.APP_GEMINI_KEY || '' : '', geminiModel: env.APP_GEMINI_MODEL || 'gemini-2.5-flash' };
    const signature = JSON.stringify([config.projectId, config.ownerEmail, config.firebaseWebApiKey]);
    if (!authentication || signature !== authenticationConfig) {
      authentication = authFactory(config, { fetcher: budgetedFetch(fetcher) }); authenticationConfig = signature;
    }
    // Basic login/status and direct Firestore metadata work without the optional
    // Drive vault. Creating this proxy neither contacts Blobs nor generates a key.
    const vault = lazyVault(() => vaultFactory(storeFactory({ name: 'career-archive-private-v1', consistency: 'strong' })));
    return apiFactory({ config, vault, auth: authentication, fetcher });
  };
}
const runtime = createFreeRuntime();
export const freeRuntime = () => runtime();
