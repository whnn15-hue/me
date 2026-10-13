import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudDrive } from '../server/cloud/drive.mjs';

const config = { appUrl: 'https://career.example/', driveCallbackUrl: 'https://api.example/project/careerApi/api/auth/callback',
  ownerEmail: 'owner@example.com', googleClientId: 'oauth-client', googleClientSecret: 'test-client-secret', encryptionKey: 'test-encryption-key-with-at-least-32-bytes' };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; },
  send(value) { this.body = value; return this; }, redirect(value) { this.redirectURL = value; return this; } });

function fixture(overrides = {}) {
  const records = new Map();
  let pendingTransaction = Promise.resolve();
  const snapshot = path => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const document = path => ({ path, collection: name => collection(`${path}/${name}`), get: async () => snapshot(path),
    create: async value => { assert.equal(records.has(path), false); records.set(path, structuredClone(value)); },
    set: async value => records.set(path, structuredClone(value)) });
  const collection = path => ({ doc: id => document(`${path}/${id}`),
    where: (field, op, value) => ({ get: async () => ({ docs: [...records.keys()].filter(key => key.startsWith(`${path}/`)
      && key.split('/').length === path.split('/').length + 1 && records.get(key)?.[field] === value).map(snapshot) }) }) });
  const db = { collection, runTransaction(callback) {
    const result = pendingTransaction.then(async () => {
      const writes = [];
      const result = await callback({ get: async ref => snapshot(ref.path),
        set: (ref, value) => writes.push(() => records.set(ref.path, structuredClone(value))), delete: ref => writes.push(() => records.delete(ref.path)) });
      for (const write of writes) write();
      return result;
    });
    pendingTransaction = result.catch(() => {});
    return result;
  } };
  const storeFactory = async (uid = 'owner-uid', accountEmail = config.ownerEmail) => ({ uid, email: accountEmail,
    getSetting: async name => records.get(`careerArchives/${uid}/settings/${name}`)?.value ?? null,
    setSetting: async (name, value) => records.set(`careerArchives/${uid}/settings/${name}`, { value: structuredClone(value) }) });
  records.set('careerArchives/owner-uid', { email: config.ownerEmail });
  const calls = [];
  const defaultFetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return json({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 3600,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file' });
    if (url.endsWith('/userinfo')) return json({ sub: 'google-owner', email: config.ownerEmail, email_verified: true });
    if (url.includes('/upload/drive/')) return json({ id: 'backup-id' });
    if (url.includes('/files?')) return json({ id: 'folder-id' });
    if (url.includes('/files/')) return json({ id: 'folder-id', trashed: false });
    if (url.endsWith('/revoke')) return json({});
    throw new Error(`Unexpected request ${url}`);
  };
  const options = { db, storeFactory, config: { ...config, ...overrides.config }, fetcher: overrides.fetcher || defaultFetcher,
    captureBackup: overrides.captureBackup || (async () => Buffer.from('ZIP-test-snapshot')) };
  return { records, db, storeFactory, options, calls, create: () => createCloudDrive(options) };
}

async function link(f, drive = f.create()) {
  const repo = await f.storeFactory();
  const start = response();
  await drive.start({ repo, user: { uid: repo.uid, email: repo.email } }, start);
  const authorization = new URL(start.body.url);
  const result = response();
  await drive.callback({ query: { state: authorization.searchParams.get('state'), code: 'authorization-code' } }, result);
  assert.equal(result.redirectURL, 'https://career.example/?connected=drive');
  return { drive, repo, authorization };
}

test('Drive defaults to disabled when secrets, owner, or HTTPS origin are missing', async () => {
  for (const invalid of [{ encryptionKey: '' }, { encryptionKey: 'short' }, { googleClientSecret: '' }, { ownerEmail: '' },
    { appUrl: 'http://career.example/' }, { appUrl: 'https://career.example/path' }, { driveCallbackUrl: 'http://api.example/callback' }]) {
    const f = fixture({ config: invalid });
    const drive = f.create();
    assert.equal(drive.configured, false);
    assert.deepEqual(await drive.scheduledBackup(), { skipped: 'drive-not-configured' });
    await assert.rejects(drive.start({ repo: await f.storeFactory(), user: { uid: 'owner-uid', email: config.ownerEmail } }, response()), { status: 503 });
    assert.equal(f.calls.length, 0);
  }
});

test('OAuth state survives instances, consumes once, uses PKCE, and encrypts tokens for one uid', async () => {
  const f = fixture();
  const repo = await f.storeFactory();
  const result = response();
  await f.create().start({ repo, user: { uid: repo.uid, email: repo.email } }, result);
  const url = new URL(result.body.url);
  assert.equal(url.searchParams.get('redirect_uri'), config.driveCallbackUrl);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /drive\.file/);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('careerArchiveOAuthStates/')).length, 1);
  const drive = f.create();
  const callback = response();
  const query = { state: url.searchParams.get('state'), code: 'code' };
  await drive.callback({ query }, callback);
  assert.equal(callback.redirectURL, 'https://career.example/?connected=drive');
  const verifier = f.calls.find(call => call.url.endsWith('/token')).options.body.get('code_verifier');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  const encrypted = await repo.getSetting('driveTokens');
  assert.match(encrypted, /^v1:/);
  assert.ok(!encrypted.includes('test-access-token'));
  assert.equal((await drive.status(repo)).driveConnected, true);
  const wrongUidRepo = await f.storeFactory('other-uid');
  await wrongUidRepo.setSetting('driveTokens', encrypted);
  assert.equal((await drive.status(wrongUidRepo)).driveConnected, false);
  const replay = response();
  await drive.callback({ query }, replay);
  assert.equal(replay.statusCode, 400);
  assert.equal(f.calls.length, 2);
});

test('OAuth rejects another Google account and consumes expired requests without network access', async () => {
  const f = fixture({ fetcher: async url => url.endsWith('/token')
    ? json({ access_token: 'access', refresh_token: 'refresh', scope: 'https://www.googleapis.com/auth/drive.file' })
    : json({ email: 'another@example.com', sub: 'other', email_verified: true }) });
  const drive = f.create();
  const repo = await f.storeFactory();
  const start = response();
  await drive.start({ repo, user: { uid: repo.uid, email: repo.email } }, start);
  const callback = response();
  await drive.callback({ query: { state: new URL(start.body.url).searchParams.get('state'), code: 'code' } }, callback);
  assert.equal(callback.statusCode, 403);
  assert.equal(await repo.getSetting('driveTokens'), null);
  await drive.start({ repo, user: { uid: repo.uid, email: repo.email } }, start);
  const stateRecord = [...f.records.entries()].find(([key]) => key.startsWith('careerArchiveOAuthStates/'));
  stateRecord[1].expiresAt = new Date(0);
  f.records.set(...stateRecord);
  await drive.callback({ query: { state: new URL(start.body.url).searchParams.get('state'), code: 'code' } }, callback);
  assert.equal(callback.statusCode, 400);
});

test('Drive creates dated immutable backups and reports successful backup status', async () => {
  const f = fixture();
  const { drive, repo } = await link(f);
  const first = await drive.backup(repo);
  const second = await drive.backup(repo);
  assert.notEqual(first.name, second.name);
  assert.equal((await drive.status(repo)).lastBackup, second.lastBackup);
  const uploads = f.calls.filter(call => call.url.includes('/upload/drive/'));
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every(call => call.options.method === 'POST'));
  assert.ok(uploads[0].options.body.includes(Buffer.from('ZIP-test-snapshot')));
  assert.equal(f.calls.filter(call => call.url.startsWith('https://www.googleapis.com/drive/v3/files?')).length, 1);
  assert.equal(f.records.has('careerArchives/owner-uid/settings/driveBackupLease'), false);
});

test('Persistent lease prevents concurrent backups and disconnect during token refresh', async () => {
  let captureEntered;
  const entered = new Promise(resolve => { captureEntered = resolve; });
  let release;
  const f = fixture({ captureBackup: async () => { captureEntered(); return new Promise(resolve => { release = () => resolve(Buffer.from('ZIP')); }); } });
  const { drive, repo } = await link(f);
  const inFlight = drive.backup(repo);
  await entered;
  await assert.rejects(f.create().backup(repo), { status: 409 });
  await assert.rejects(drive.disconnect({ repo }, response()), { status: 409 });
  release();
  await inFlight;
  const result = response();
  await drive.disconnect({ repo }, result);
  assert.equal(result.body.revoked, true);
  assert.equal((await drive.status(repo)).driveConnected, false);
});

test('Failed upload leaves last successful backup intact and releases persistent lease', async () => {
  const f = fixture();
  const { repo, drive } = await link(f);
  const successful = await drive.backup(repo);
  const broken = createCloudDrive({ ...f.options, fetcher: async (url, options) => url.includes('/upload/drive/')
    ? json({}, 503) : f.options.fetcher(url, options) });
  await assert.rejects(broken.backup(repo), { status: 502 });
  const state = await broken.status(repo);
  assert.equal(state.lastBackup, successful.lastBackup);
  assert.match(state.backupError, /업로드/);
  assert.equal(f.records.has('careerArchives/owner-uid/settings/driveBackupLease'), false);
});

test('Expired access tokens refresh securely and changing the encryption key requires relinking', async () => {
  const f = fixture();
  const { repo } = await link(f);
  const shortTokenFetcher = async (url, options) => url.endsWith('/token') && options.body.get('grant_type') === 'authorization_code'
    ? json({ access_token: 'expiring-access-token', refresh_token: 'test-refresh-token', expires_in: 1,
      scope: 'https://www.googleapis.com/auth/drive.file' }) : f.options.fetcher(url, options);
  const drive = createCloudDrive({ ...f.options, fetcher: shortTokenFetcher });
  await link(f, drive);
  await drive.backup(repo);
  const refresh = f.calls.find(call => call.url.endsWith('/token') && call.options.body.get('grant_type') === 'refresh_token');
  assert.ok(refresh);
  assert.equal(refresh.options.body.get('refresh_token'), 'test-refresh-token');
  const rotated = createCloudDrive({ ...f.options, config: { ...config, encryptionKey: 'new-independent-key-with-at-least-32-bytes' } });
  assert.equal((await rotated.status(repo)).driveConnected, false);
  await assert.rejects(rotated.backup(repo), { status: 409 });
});

test('Scheduled backup filters the private archive namespace by configured owner', async () => {
  const f = fixture();
  const { drive, repo } = await link(f);
  f.records.set('careerArchives/other-uid', { email: 'other@example.com' });
  const result = await drive.scheduledBackup();
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].uid, repo.uid);
  assert.equal(result.results[0].ok, true);
  assert.equal((await drive.status(repo)).driveConnected, true);
});
