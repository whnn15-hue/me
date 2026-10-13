import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { createCloudApp } from '../server/cloud/app.mjs';

const aiEnabled = process.env.APP_AI_ENABLED === 'true';
const driveEnabled = process.env.APP_DRIVE_ENABLED === 'true';
const driveSecrets = driveEnabled ? [defineSecret('GOOGLE_CLIENT_SECRET'), defineSecret('APP_ENCRYPTION_KEY')] : [];
const secrets = [...driveSecrets];
if (aiEnabled) secrets.push(defineSecret('APP_AI_KEY'));
const region = process.env.APP_FUNCTION_REGION || process.env.FIREBASE_FUNCTION_REGION || 'asia-northeast3';
const serviceAccount = process.env.APP_FUNCTION_SERVICE_ACCOUNT || process.env.FIREBASE_FUNCTION_SERVICE_ACCOUNT || undefined;
let service;
function runtime() {
  if (service) return service;
  const projectId = process.env.APP_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '';
  const storageBucket = process.env.APP_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '';
  const admin = getApps()[0] || initializeApp({ projectId: projectId || undefined, storageBucket: storageBucket || undefined });
  const apiUrl = String(process.env.APP_API_URL || '').replace(/\/$/, '');
  const config = { projectId, storageBucket, appUrl: process.env.APP_URL || '', apiUrl, driveCallbackUrl: apiUrl ? `${apiUrl}/api/auth/callback` : '', ownerEmail: process.env.OWNER_EMAIL || '', aiEnabled, aiKey: aiEnabled ? process.env.APP_AI_KEY || '' : '', driveEnabled, googleClientId: driveEnabled ? process.env.GOOGLE_CLIENT_ID || '' : '', googleClientSecret: driveEnabled ? process.env.GOOGLE_CLIENT_SECRET || '' : '', encryptionKey: driveEnabled ? process.env.APP_ENCRYPTION_KEY || '' : '' };
  service = createCloudApp({ db: getFirestore(admin), bucket: storageBucket ? getStorage(admin).bucket(storageBucket) : null, auth: getAuth(admin), config });
  return service;
}
export const careerApi = onRequest({ region, cors: false, timeoutSeconds: 120, memory: '1GiB', maxInstances: 5, secrets, ...(serviceAccount ? { serviceAccount } : {}) }, (req, res) => runtime().app(req, res));
export const careerBackup = driveEnabled ? onSchedule({ region, schedule: '0 3 * * *', timeZone: 'Asia/Seoul', timeoutSeconds: 540, memory: '1GiB', maxInstances: 1, secrets: driveSecrets, ...(serviceAccount ? { serviceAccount } : {}) }, () => runtime().drive.scheduledBackup()) : undefined;
