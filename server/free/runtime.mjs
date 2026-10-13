import { getStore } from '@netlify/blobs';
import { createPrivateVault } from './vault.mjs';
import { createFreeApi } from './api.mjs';
let instance;
export function freeRuntime() {
  if (!instance) instance = (async () => {
    const aiEnabled = process.env.APP_AI_ENABLED === 'true'; const driveEnabled = process.env.APP_DRIVE_ENABLED === 'true';
    const config = { appUrl: String(process.env.APP_URL || '').replace(/\/$/, ''), ownerEmail: process.env.OWNER_EMAIL || '', projectId: process.env.APP_FIREBASE_PROJECT_ID || '', firebaseWebApiKey: process.env.APP_FIREBASE_WEB_API_KEY || '', driveEnabled, googleClientId: driveEnabled ? process.env.GOOGLE_CLIENT_ID || '' : '', googleClientSecret: driveEnabled ? process.env.GOOGLE_CLIENT_SECRET || '' : '', aiEnabled, geminiKey: aiEnabled ? process.env.APP_GEMINI_KEY || '' : '', geminiModel: process.env.APP_GEMINI_MODEL || 'gemini-2.5-flash' };
    const vault = await createPrivateVault(getStore({ name: 'career-archive-private-v1', consistency: 'strong' }));
    return createFreeApi({ config, vault });
  })().catch(error => { instance = undefined; throw error; });
  return instance;
}
