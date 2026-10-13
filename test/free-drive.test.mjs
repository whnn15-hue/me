import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFreeDrive } from '../server/free/drive.mjs';

const config = { appUrl: 'https://career.netlify.app', ownerEmail: 'owner@example.com', googleClientId: 'oauth-client', googleClientSecret: 'oauth-secret' };
const owner = { uid: 'owner-uid', email: config.ownerEmail, token: 'verified-firebase-id-token' };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const response = () => ({ statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
  status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; },
  send(value) { this.body = value; return this; }, redirect(value) { this.redirectURL = value; return this; } });

function fixture(overrides = {}) {
  const records = new Map();
  const leases = new Map();
  const files = new Map();
  const calls = [];
  const refreshCalls = [];
  let sequence = 0;
  const vault = {
    getJSON: async key => structuredClone(records.get(key) ?? null),
    setJSON: async (key, value) => { records.set(key, structuredClone(value)); },
    deleteJSON: async key => { records.delete(key); },
    consumeJSON: async key => { const value = structuredClone(records.get(key) ?? null); records.delete(key); return value; },
    acquireLease: async key => {
      if (leases.has(key)) throw Object.assign(new Error('백업이 진행 중입니다.'), { status: 409 });
      const lease = {};
      leases.set(key, lease);
      return async () => { if (leases.get(key) === lease) leases.delete(key); };
    },
  };
  const defaultFetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return json({ access_token: 'drive-access-token', refresh_token: 'drive-refresh-token', expires_in: 3600,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file' });
    if (url.endsWith('/userinfo')) return json({ sub: 'google-owner', email: config.ownerEmail, email_verified: true });
    if (url.endsWith('/revoke')) return json({});
    if (url.includes('/upload/drive/')) return json({ id: `upload-${++sequence}` });
    if (url.includes('/drive/v3/files?')) {
      const metadata = JSON.parse(options.body);
      const id = `folder-${++sequence}`;
      files.set(id, { ...metadata, id, trashed: false });
      return json({ id });
    }
    if (url.includes('/drive/v3/files/')) {
      const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
      return files.has(id) ? json(files.get(id)) : json({}, 404);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const refreshFirebaseOwner = overrides.refreshFirebaseOwner || (async (refreshToken, { uid }) => {
    refreshCalls.push({ refreshToken, uid });
    return { uid, email: config.ownerEmail, idToken: 'refreshed-firebase-id-token', refreshToken: 'firebase-refresh-token' };
  });
  const captureCalls = [];
  const options = { vault, config: { ...config, ...overrides.config }, fetcher: overrides.fetcher || defaultFetcher,
    refreshFirebaseOwner, captureSnapshot: overrides.captureSnapshot,
    captureBackup: overrides.captureBackup || (async (uid, options) => { captureCalls.push({ uid, options }); return Buffer.from('ZIP-private-originals'); }) };
  return { records, leases, files, calls, refreshCalls, captureCalls, defaultFetcher, options, create: () => createFreeDrive(options) };
}

async function begin(f, drive = f.create()) {
  const result = response();
  await drive.start({ user: owner, body: { firebaseRefreshToken: 'firebase-refresh-token' } }, result);
  return { result, authorization: new URL(result.body.url) };
}
async function connect(f, drive = f.create()) {
  const { authorization } = await begin(f, drive);
  const result = response();
  await drive.callback({ query: { state: authorization.searchParams.get('state'), code: 'authorization-code' } }, result);
  assert.equal(result.redirectURL, 'https://career.netlify.app/?connected=drive');
  return { drive, authorization };
}

test('free Drive is disabled without a verified HTTPS root origin, owner, or OAuth credentials', async () => {
  for (const missing of [{ appUrl: 'http://career.netlify.app' }, { appUrl: 'https://career.netlify.app/path' },
    { appUrl: 'https://user:pass@career.netlify.app/' }, { appUrl: 'https://career.netlify.app/?query=1' },
    { ownerEmail: '' }, { googleClientId: '' }, { googleClientSecret: '' }, { driveEnabled: false }]) {
    const f = fixture({ config: missing });
    const drive = f.create();
    assert.equal(drive.configured, false);
    assert.deepEqual(await drive.scheduled(), { skipped: 'drive-not-configured' });
    await assert.rejects(begin(f, drive), { status: 503 });
    assert.equal(f.calls.length, 0);
  }
});

test('connect verifies the Firebase refresh identity before retaining any credential', async () => {
  const f = fixture({ refreshFirebaseOwner: async () => ({ uid: 'another-uid', email: config.ownerEmail, idToken: 'other-token', refreshToken: 'other-refresh' }) });
  await assert.rejects(begin(f), { status: 403 });
  assert.equal(f.records.size, 0);
  assert.equal(f.calls.length, 0);
  const valid = fixture();
  await assert.rejects(valid.create().start({ user: owner, body: {} }, response()), { status: 400 });
  await assert.rejects(valid.create().start({ user: { ...owner, email: 'another@example.com' }, body: { firebaseRefreshToken: 'refresh' } }, response()), { status: 403 });
  assert.equal(valid.records.size, 0);
});

test('OAuth uses PKCE, consumes state across instances once, and keeps refresh credentials out of responses', async () => {
  const f = fixture();
  const { result, authorization } = await begin(f);
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://career.netlify.app/api/auth/callback');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('login_hint'), config.ownerEmail);
  assert.ok(!JSON.stringify(result.body).includes('firebase-refresh-token'));
  const query = { state: authorization.searchParams.get('state'), code: 'authorization-code' };
  const results = [response(), response()];
  await Promise.all(results.map(res => f.create().callback({ query }, res)));
  assert.deepEqual(results.map(res => res.statusCode).sort(), [200, 400]);
  assert.equal(results.filter(res => res.redirectURL).length, 1);
  const verifier = f.calls.find(call => call.url.endsWith('/token')).options.body.get('code_verifier');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), authorization.searchParams.get('code_challenge'));
  assert.equal(f.calls.length, 2);
  assert.equal((await f.create().status(owner)).driveConnected, true);
  assert.equal(f.records.get(`firebaseTokens/${owner.uid}`).refreshToken, 'firebase-refresh-token');
});

test('expired OAuth state and mismatched Google profile cannot connect Drive', async () => {
  const expired = fixture();
  const { authorization } = await begin(expired);
  const stateKey = [...expired.records.keys()].find(key => key.startsWith('oauthStates/'));
  expired.records.get(stateKey).expiresAt = 0;
  const result = response();
  await expired.create().callback({ query: { state: authorization.searchParams.get('state'), code: 'code' } }, result);
  assert.equal(result.statusCode, 400);
  assert.equal(expired.calls.length, 0);
  for (const profile of [{ sub: 'other', email: 'another@example.com', email_verified: true }, { sub: 'owner', email: config.ownerEmail, email_verified: false }]) {
    const f = fixture();
    const drive = createFreeDrive({ ...f.options, fetcher: (url, options) => url.endsWith('/userinfo') ? json(profile) : f.defaultFetcher(url, options) });
    const start = await begin(f, drive);
    const callback = response();
    await drive.callback({ query: { state: start.authorization.searchParams.get('state'), code: 'code' } }, callback);
    assert.equal(callback.statusCode, 403);
    assert.equal(f.records.has(`driveTokens/${owner.uid}`), false);
  }
});

test('Drive access returns only a short-lived token and an owner-marked private folder', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const result = response();
  await drive.access({ user: owner }, result);
  assert.deepEqual(Object.keys(result.body).sort(), ['accessToken', 'expiresAt', 'folderId']);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.ok(!JSON.stringify(result.body).includes('refresh-token'));
  const folder = f.files.get(result.body.folderId);
  assert.deepEqual(folder.appProperties, { archiveUid: owner.uid, kind: 'archive-folder' });
  assert.ok(!f.calls.some(call => call.url.includes('/permissions')));
  await assert.rejects(drive.access({ user: { ...owner, uid: 'another-uid' } }, response()), { status: 403 });
  await assert.rejects(drive.access({}, response()), { status: 401 });
});

test('access refreshes expired Drive credentials and rejects a modified folder ownership marker', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  f.records.get(`driveTokens/${owner.uid}`).expiresAt = 0;
  const access = await drive.accessFor(owner.uid);
  const refresh = f.calls.find(call => call.url.endsWith('/token') && call.options.body.get('grant_type') === 'refresh_token');
  assert.equal(refresh.options.body.get('refresh_token'), 'drive-refresh-token');
  f.files.get(access.folderId).appProperties.archiveUid = 'another-uid';
  await assert.rejects(drive.accessFor(owner.uid), { status: 403 });
  assert.equal(f.leases.size, 0);
});

test('original file lookup rejects arbitrary Drive files, folders, and cross-kind substitution', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const { folderId } = await drive.accessFor(owner.uid);
  f.files.set('document-id', { id: 'document-id', name: '공문.pdf', size: '123', mimeType: 'application/pdf', parents: [folderId], appProperties: { archiveUid: owner.uid, kind: 'document' } });
  const result = await drive.requireFile(owner.uid, 'document-id', { kind: 'document' });
  assert.equal(result.metadata.name, '공문.pdf');
  assert.equal(result.accessToken, 'drive-access-token');
  await assert.rejects(drive.requireFile(owner.uid, 'document-id', { kind: 'template' }), { status: 403 });
  f.files.get('document-id').parents = ['other-folder'];
  await assert.rejects(drive.requireFile(owner.uid, 'document-id'), { status: 403 });
  await assert.rejects(drive.requireFile(owner.uid, folderId), { status: 403 });
  await assert.rejects(drive.requireFile(owner.uid, '../untrusted'), { status: 400 });
});

test('dated Drive backups preserve originals, owner metadata, digest, and successful status', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const first = await drive.backup(owner);
  const second = await drive.backup(owner);
  assert.notEqual(first.fileName, second.fileName);
  assert.notEqual(first.driveFileId, second.driveFileId);
  assert.equal((await drive.status(owner)).lastBackup, second.lastBackup);
  assert.deepEqual(f.captureCalls[0], { uid: owner.uid, options: { idToken: owner.token, driveAccessToken: 'drive-access-token' } });
  const uploads = f.calls.filter(call => call.url.includes('/upload/drive/'));
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(call => call.options.method === 'POST'));
  assert.ok(uploads[0].options.body.includes(Buffer.from('ZIP-private-originals')));
  assert.ok(uploads[0].options.body.includes(Buffer.from('"kind":"backup"')));
  assert.ok(uploads[0].options.body.includes(Buffer.from(createHash('sha256').update('ZIP-private-originals').digest('hex'))));
  assert.equal(f.calls.filter(call => call.url.startsWith('https://www.googleapis.com/drive/v3/files?')).length, 1);
  assert.equal(f.leases.size, 0);
});

test('persistent owner lease prevents concurrent backup and disconnect', async () => {
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  let releaseCapture;
  const f = fixture({ captureBackup: async () => { enteredResolve(); return new Promise(resolve => { releaseCapture = () => resolve(Buffer.from('ZIP')); }); } });
  const { drive } = await connect(f);
  const inFlight = drive.backup(owner);
  await entered;
  await assert.rejects(f.create().backup(owner), { status: 409 });
  await assert.rejects(f.create().disconnect({ user: owner }, response()), { status: 409 });
  releaseCapture();
  await inFlight;
  assert.equal(f.leases.size, 0);
});

test('backup file validation uses its existing token without acquiring a nested lease', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const { folderId } = await drive.accessFor(owner.uid);
  f.files.set('original-id', { id: 'original-id', name: '원본.pdf', size: '3', mimeType: 'application/pdf',
    parents: [folderId], appProperties: { archiveUid: owner.uid, kind: 'document' } });
  const backupDrive = createFreeDrive({ ...f.options, captureBackup: async (uid, { driveAccessToken }) => {
    const result = await drive.requireFile(uid, 'original-id', { kind: 'document', driveAccessToken });
    assert.equal(result.metadata.id, 'original-id');
    return Buffer.from('ZIP');
  } });
  const result = await backupDrive.backup(owner);
  assert.equal(result.ok, true);
  assert.equal(f.leases.size, 0);
});

test('upload failure retains the last successful backup and exposes a safe error', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const success = await drive.backup(owner);
  const broken = createFreeDrive({ ...f.options, fetcher: (url, options) => url.includes('/upload/drive/') ? json({}, 503) : f.defaultFetcher(url, options) });
  await assert.rejects(broken.backup(owner), { status: 502 });
  const status = await broken.status(owner);
  assert.equal(status.lastBackup, success.lastBackup);
  assert.match(status.backupError, /업로드/);
  assert.equal(f.leases.size, 0);
});

test('scheduled backup refreshes the stored owner login and runs after the browser closes', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const result = await f.create().scheduled();
  assert.equal(result.results[0].ok, true);
  assert.equal(f.refreshCalls.length, 2);
  assert.deepEqual(f.captureCalls[0], { uid: owner.uid, options: { idToken: 'refreshed-firebase-id-token', driveAccessToken: 'drive-access-token' } });
  assert.equal((await drive.status(owner)).lastBackup, result.results[0].lastBackup);
  f.records.set('configuredOwner', { uid: 'other', email: 'other@example.com' });
  assert.deepEqual(await drive.scheduled(), { skipped: 'owner-not-connected' });
});

test('manual and scheduled free backups upload JSON metadata without downloading original files', async () => {
  const snapshotCalls = [];
  const data = { schemaVersion: 1, careers: [{ id: 'career-1', title: '강의' }],
    documents: [{ id: 'document-1', driveFileId: 'original-id', sha256: 'a'.repeat(64) }] };
  const f = fixture({ captureSnapshot: async (uid, context) => {
    snapshotCalls.push({ uid, context });
    return Buffer.from(JSON.stringify(data));
  }, captureBackup: async () => { throw new Error('Full ZIP capture must not run for metadata backups'); } });
  const { drive } = await connect(f);
  const manual = await drive.backup(owner);
  const scheduled = await drive.scheduled();
  assert.equal(manual.lastBackupKind, 'snapshot');
  assert.equal(scheduled.results[0].lastBackupKind, 'snapshot');
  assert.match(manual.fileName, /^career-snapshot-.*\.json$/);
  assert.equal(manual.mime, 'application/json');
  assert.notEqual(manual.fileName, scheduled.results[0].fileName);
  assert.deepEqual(snapshotCalls, [{ uid: owner.uid, context: { idToken: owner.token } },
    { uid: owner.uid, context: { idToken: 'refreshed-firebase-id-token' } }]);
  assert.equal(f.captureCalls.length, 0);
  assert.equal(f.calls.filter(call => call.url.includes('original-id') || call.url.includes('alt=media')).length, 0);
  const uploads = f.calls.filter(call => call.url.includes('/upload/drive/'));
  assert.equal(uploads.length, 2);
  assert.ok(uploads[0].options.body.includes(Buffer.from(JSON.stringify(data))));
  assert.ok(uploads[0].options.body.includes(Buffer.from('Content-Type: application/json')));
  assert.equal((await drive.status(owner)).lastBackupKind, 'snapshot');
});

test('JSON snapshots reject oversize or invalid payloads without uploading or replacing successful status', async () => {
  const f = fixture({ captureSnapshot: async () => Buffer.from('{"careers":[],"documents":[]}') });
  const { drive } = await connect(f);
  const successful = await drive.backup(owner);
  const uploads = f.calls.filter(call => call.url.includes('/upload/drive/')).length;
  for (const [buffer, status] of [[Buffer.alloc(5 * 1024 * 1024 + 1), 413], [Buffer.from('not JSON'), 502]]) {
    const broken = createFreeDrive({ ...f.options, captureSnapshot: async () => buffer });
    await assert.rejects(broken.backup(owner), { status });
    assert.equal((await broken.status(owner)).lastBackup, successful.lastBackup);
    assert.equal((await broken.status(owner)).lastBackupKind, 'snapshot');
    assert.equal(f.calls.filter(call => call.url.includes('/upload/drive/')).length, uploads);
    assert.equal(f.leases.size, 0);
  }
});

test('disconnect removes both refresh credentials, retains backups, and cancels pending OAuth', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const backup = await drive.backup(owner);
  const pending = await begin(f, drive);
  const result = response();
  await drive.disconnect({ user: owner }, result);
  assert.deepEqual(result.body, { ok: true, revoked: true });
  assert.equal(f.records.has(`driveTokens/${owner.uid}`), false);
  assert.equal(f.records.has(`firebaseTokens/${owner.uid}`), false);
  assert.equal((await drive.status(owner)).lastBackup, backup.lastBackup);
  const callback = response();
  await drive.callback({ query: { state: pending.authorization.searchParams.get('state'), code: 'code' } }, callback);
  assert.equal(callback.statusCode, 409);
  assert.deepEqual(await drive.scheduled(), { skipped: 'drive-not-connected' });
});

test('disconnect and reconnect preserve the private folder and existing original document links', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const { folderId } = await drive.accessFor(owner.uid);
  f.files.set('existing-original', { id: 'existing-original', name: '기존 공문.pdf', mimeType: 'application/pdf', size: '123',
    parents: [folderId], appProperties: { archiveUid: owner.uid, kind: 'document' } });
  await drive.disconnect({ user: owner }, response());
  assert.equal(f.records.get(`driveFolder/${owner.uid}`), folderId);
  assert.equal(f.files.has('existing-original'), true);
  await connect(f, drive);
  const access = await drive.accessFor(owner.uid);
  assert.equal(access.folderId, folderId);
  const file = await drive.requireFile(owner.uid, 'existing-original', { kind: 'document' });
  assert.equal(file.metadata.name, '기존 공문.pdf');
  assert.equal(f.calls.filter(call => call.url.startsWith('https://www.googleapis.com/drive/v3/files?')).length, 1);
  assert.equal(f.calls.filter(call => call.options.method === 'DELETE' || call.options.method === 'PATCH').length, 0);
});

test('scheduled backup cannot restore credentials deleted during a Firebase refresh', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  let finishRefresh;
  const scheduledDrive = createFreeDrive({ ...f.options, refreshFirebaseOwner: async () => {
    startedResolve();
    return new Promise(resolve => { finishRefresh = () => resolve({ uid: owner.uid, email: owner.email,
      idToken: 'refreshed-id-token', refreshToken: 'rotated-firebase-refresh-token' }); });
  } });
  const inFlight = scheduledDrive.scheduled();
  await started;
  await drive.disconnect({ user: owner }, response());
  finishRefresh();
  const result = await inFlight;
  assert.equal(result.results[0].ok, false);
  assert.equal(f.records.has(`firebaseTokens/${owner.uid}`), false);
  assert.equal(f.calls.filter(call => call.url.includes('/upload/drive/')).length, 0);
});
