import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_REGION = 'asia-northeast3';

function invalid(message) { throw new Error(message); }
function scalar(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) invalid(`${label}: 비어 있거나 올바르지 않습니다.`);
  return value.trim();
}
function secureUrl(value, label, originOnly = false) {
  let url;
  try { url = new URL(scalar(value, label)); } catch { invalid(`${label}: 올바른 HTTPS 주소가 필요합니다.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || /^(?:localhost|127\.|0\.0\.0\.0$|\[::1\]$)/i.test(url.hostname)
      || (originOnly && url.pathname !== '/')) invalid(`${label}: 경로·인증 정보가 없는 실제 HTTPS 주소가 필요합니다.`);
  return originOnly ? url.origin : url.href.replace(/\/$/, '');
}
function encodeEnv(values) {
  return Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(String(value))}`).join('\n') + '\n';
}

export function freeFirestoreRules(owner) {
  const email = JSON.stringify(scalar(owner, '--owner').toLowerCase());
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isOwner(uid) {
      return request.auth != null
        && request.auth.uid == uid
        && request.auth.token.email_verified == true
        && request.auth.token.email.lower() == ${email}
        && request.auth.token.firebase.sign_in_provider == 'google.com';
    }
    function archivePath(uid) {
      return /databases/$(database)/documents/careerArchives/$(uid);
    }
    function validArchive(data) {
      return data.keys().hasOnly(['activeVersion', 'revision'])
        && data.activeVersion is string
        && data.activeVersion.matches('^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
        && data.revision is int && data.revision >= 1;
    }
    function canWriteVersion(uid, version) {
      // Staging a new/inactive version does not change the visible archive.
      return !exists(archivePath(uid))
        || get(archivePath(uid)).data.activeVersion != version
        || getAfter(archivePath(uid)).data.revision == get(archivePath(uid)).data.revision + 1;
    }
    match /careerArchives/{uid} {
      allow get: if isOwner(uid);
      allow create: if isOwner(uid) && validArchive(request.resource.data)
        && request.resource.data.revision == 1;
      allow update: if isOwner(uid) && validArchive(request.resource.data)
        && request.resource.data.revision == resource.data.revision + 1;
      match /versions/{version} {
        match /careers/{career} {
          allow read: if isOwner(uid);
          allow write: if isOwner(uid) && canWriteVersion(uid, version);
        }
        match /documents/{document} {
          allow read: if isOwner(uid);
          allow write: if isOwner(uid) && canWriteVersion(uid, version);
        }
      }
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;
}

export function cloudConfiguration(options, sdkConfig) {
  const mode = options.mode || 'free';
  if (!['free', 'paid'].includes(mode)) invalid('--mode: free 또는 paid만 지원합니다.');
  const project = scalar(options.project, '--project');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) invalid('--project: Firebase 프로젝트 ID가 필요합니다.');
  const site = secureUrl(options.site, '--site', true);
  const owner = scalar(options.owner, '--owner').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) invalid('--owner: 본인 구글 계정 이메일이 필요합니다.');
  if (!sdkConfig || typeof sdkConfig !== 'object' || Array.isArray(sdkConfig)) invalid('--web-config: Firebase 웹 앱 설정 JSON 객체가 필요합니다.');
  const publicFields = new Set(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId', 'databaseURL']);
  if (Object.keys(sdkConfig).some(name => !publicFields.has(name))) invalid('Firebase 웹 앱 공개 설정만 사용하세요. 서비스 계정 JSON이나 비밀값은 이 명령에서 받지 않습니다.');
  for (const name of ['apiKey', 'authDomain', 'projectId', 'appId']) scalar(sdkConfig[name], `web-config.${name}`);
  if (sdkConfig.projectId !== project) invalid('웹 앱 설정의 projectId와 --project가 다릅니다.');
  if (!/^[a-z0-9-]+\.(?:firebaseapp\.com|web\.app)$/i.test(sdkConfig.authDomain)) invalid('기본 Firebase authDomain을 사용하세요. 사용자 도메인은 CSP와 인증 설정을 별도로 맞춰야 합니다.');
  const frontend = {
    VITE_CLOUD_MODE: 'true',
    VITE_DEPLOYMENT_MODE: mode,
    VITE_FIREBASE_API_KEY: sdkConfig.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: sdkConfig.authDomain,
    VITE_FIREBASE_PROJECT_ID: project,
    VITE_FIREBASE_APP_ID: sdkConfig.appId,
  };
  if (sdkConfig.messagingSenderId) frontend.VITE_FIREBASE_MESSAGING_SENDER_ID = scalar(sdkConfig.messagingSenderId, 'web-config.messagingSenderId');
  const server = {
    APP_URL: site,
    OWNER_EMAIL: owner,
    APP_FIREBASE_PROJECT_ID: project,
    APP_AI_ENABLED: options.ai ? 'true' : 'false',
    APP_DRIVE_ENABLED: options.drive ? 'true' : 'false',
  };
  if (options.drive) server.GOOGLE_CLIENT_ID = scalar(options.googleClientId, '--google-client-id (Drive 사용 시)');
  if (mode === 'free') {
    if (options.bucket || options.apiUrl || options.serviceAccount || options.region) invalid('무료 방식에는 --bucket, --api-url, --service-account, --region을 지정하지 않습니다. 유료 방식은 --mode paid를 명시하세요.');
    server.APP_FIREBASE_WEB_API_KEY = sdkConfig.apiKey;
    return { mode, project, frontend: encodeEnv(frontend), server: encodeEnv(server), rules: freeFirestoreRules(owner) };
  }

  const bucket = scalar(options.bucket, '--bucket (--mode paid 사용 시)').replace(/^gs:\/\//, '');
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket) || bucket.includes('..')) invalid('--bucket: Storage 버킷 이름이 필요합니다.');
  if (sdkConfig.storageBucket !== bucket) invalid('웹 앱 설정의 storageBucket과 --bucket이 다릅니다.');
  const region = options.region || DEFAULT_REGION;
  if (!/^[a-z]+-[a-z]+\d+$/.test(region)) invalid('--region: Google Cloud 리전 이름이 필요합니다.');
  const api = secureUrl(options.apiUrl || `https://${region}-${project}.cloudfunctions.net/careerApi`, '--api-url');
  if (new URL(api).pathname.endsWith('/api')) invalid('--api-url은 /api 앞의 함수 기본 주소여야 합니다.');
  server.APP_API_URL = api;
  server.APP_STORAGE_BUCKET = bucket;
  server.APP_FUNCTION_REGION = region;
  if (options.serviceAccount) {
    const serviceAccount = scalar(options.serviceAccount, '--service-account');
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(serviceAccount)) invalid('--service-account: 서비스 계정 이메일이 필요합니다.');
    server.APP_FUNCTION_SERVICE_ACCOUNT = serviceAccount;
  }
  frontend.VITE_API_ORIGIN = api;
  frontend.VITE_FIREBASE_STORAGE_BUCKET = bucket;
  return {
    mode, project, frontend: encodeEnv(frontend), server: encodeEnv(server),
    cors: JSON.stringify([{ origin: [site], method: ['GET', 'HEAD', 'PUT'], responseHeader: ['Content-Type', 'Content-Length', 'ETag'], maxAgeSeconds: 3600 }], null, 2) + '\n',
  };
}

export async function writeCloudConfiguration(root, configuration) {
  const outputs = configuration.mode === 'free' ? [
    [join(root, '.env.production.local'), configuration.frontend],
    [join(root, '.cloud-local', 'netlify-server.env'), configuration.server],
    [join(root, '.cloud-local', 'firestore.rules'), configuration.rules],
  ] : [
    [join(root, '.env.production.local'), configuration.frontend],
    [join(root, 'functions', `.env.${configuration.project}`), configuration.server],
    [join(root, '.cloud-local', 'storage-cors.json'), configuration.cors],
  ];
  const created = [];
  try {
    for (const [path, contents] of outputs) {
      await mkdir(dirname(path), { recursive: true });
      const file = await open(path, 'wx', 0o600);
      created.push(path);
      try { await file.writeFile(contents); } finally { await file.close(); }
    }
  } catch (error) {
    await Promise.allSettled(created.map(path => unlink(path)));
    if (error.code === 'EEXIST') invalid('설정 파일이 이미 있습니다. 기존 내용을 보존했으며 자동 덮어쓰기는 하지 않았습니다. 변경할 이름만 직접 수정하세요.');
    throw error;
  }
  return outputs.map(([path]) => path);
}

const usage = `사용법: node scripts/prepare-cloud-config.mjs --project PROJECT_ID --site https://SITE.netlify.app --owner EMAIL --web-config .cloud-local/firebase-web-config.json
기본: --mode free (Firebase Spark + Netlify + Google Drive)
선택: --ai --drive --google-client-id OAUTH_CLIENT_ID
유료 선택: --mode paid --bucket BUCKET_NAME [--region REGION] [--api-url FUNCTION_BASE_URL] [--service-account SERVICE_ACCOUNT]
이 명령은 로컬 설정 파일만 생성하며 배포·권한 변경·비밀값 저장을 하지 않습니다.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(usage); return; }
  const supported = new Map([
    ['--mode', 'mode'], ['--project', 'project'], ['--bucket', 'bucket'], ['--site', 'site'], ['--owner', 'owner'],
    ['--web-config', 'webConfig'], ['--region', 'region'], ['--api-url', 'apiUrl'],
    ['--service-account', 'serviceAccount'], ['--google-client-id', 'googleClientId'],
  ]);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--ai' || arg === '--drive') { options[arg.slice(2)] = true; continue; }
    const name = supported.get(arg);
    if (!name || !args[index + 1] || args[index + 1].startsWith('--')) invalid(`옵션을 확인하세요.\n${usage}`);
    options[name] = args[++index];
  }
  if (!options.webConfig) invalid(`--web-config가 필요합니다.\n${usage}`);
  let sdkConfig;
  try { sdkConfig = JSON.parse(await readFile(resolve(options.webConfig), 'utf8')); }
  catch { invalid('Firebase 웹 앱 설정 JSON을 읽을 수 없습니다. 설정 객체만 JSON 형식으로 저장하세요.'); }
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const configuration = cloudConfiguration(options, sdkConfig);
  const paths = await writeCloudConfiguration(root, configuration);
  for (const path of paths) console.log(`생성: ${path}`);
  console.log(configuration.mode === 'free'
    ? '무료 배포 설정을 생성했습니다. 서버 변수와 비밀값은 Netlify 환경 변수에서 설정하세요.'
    : '유료 배포 설정을 생성했습니다. 비밀값은 Firebase Secret Manager에서 설정하세요.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
