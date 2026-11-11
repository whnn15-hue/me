import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFreeOneDrive, UPLOAD_CHUNK_BYTES, decodeArchiveDescription, oneDriveName } from '../server/free/onedrive.mjs';
import { readDriveFile } from '../server/free/files.mjs';
import { validGoogleDriveId, validOneDriveItemId, validStorageFileId } from '../shared/storage-id.mjs';

const config = { appUrl: 'https://career.example.app', ownerEmail: 'owner@example.com', microsoftClientId: 'ms-client', microsoftClientSecret: 'ms-secret' };
const owner = { uid: 'owner-uid', email: config.ownerEmail, token: 'verified-firebase-id-token' };
const FOLDER = 'ABCDEF0123456789!101';
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const response = () => ({ statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
  status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; },
  send(value) { this.body = value; return this; }, redirect(value) { this.redirectURL = value; return this; } });

function fixture(overrides = {}) {
  const records = new Map();
  const leases = new Map();
  const items = new Map();
  const sessions = new Map();
  const calls = [];
  let sequence = 0, tokenCount = 0;
  const vault = {
    getJSON: async key => structuredClone(records.get(key) ?? null),
    setJSON: async (key, value) => { records.set(key, structuredClone(value)); },
    deleteJSON: async key => { records.delete(key); },
    consumeJSON: async key => { const value = structuredClone(records.get(key) ?? null); records.delete(key); return value; },
    acquireLease: async key => {
      if (leases.has(key)) throw Object.assign(new Error('작업 중'), { status: 409 });
      const lease = {}; leases.set(key, lease);
      return async () => { if (leases.get(key) === lease) leases.delete(key); };
    },
  };
  const fetcher = overrides.fetcher || (async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth2/v2.0/token')) {
      const body = new URLSearchParams(options.body);
      tokenCount++;
      return json({ access_token: `graph-access-${tokenCount}`, refresh_token: `ms-refresh-${tokenCount}`, expires_in: 3600,
        scope: overrides.scope ?? 'Files.ReadWrite.AppFolder User.Read profile openid', grant: body.get('grant_type') });
    }
    if (url.includes('/v1.0/me?')) return json({ id: overrides.accountId || 'ms-account-1', userPrincipalName: 'Personal@Outlook.com' });
    if (url.includes('/special/approot')) return json({ id: FOLDER, name: 'Apps' });
    if (url.endsWith(':/createUploadSession')) {
      const name = decodeURIComponent(url.split(':/').at(-2));
      const uploadUrl = `https://api.onedrive.com/rup/session-${++sequence}`;
      sessions.set(uploadUrl, { name, item: JSON.parse(options.body).item, chunks: [] });
      return json({ uploadUrl });
    }
    if (url.startsWith('https://api.onedrive.com/rup/')) {
      const session = sessions.get(url);
      if (options.method === 'DELETE') { sessions.delete(url); return json({}, 204); }
      assert.equal(options.headers.Authorization, undefined, 'upload URL must not receive the Graph token');
      session.chunks.push({ range: options.headers['Content-Range'], bytes: Buffer.from(options.body) });
      const total = Number(options.headers['Content-Range'].split('/')[1]);
      const received = session.chunks.reduce((sum, chunk) => sum + chunk.bytes.length, 0);
      if (received < total) return json({ nextExpectedRanges: [`${received}-`] }, 202);
      const id = `ABCDEF0123456789!${200 + sequence}`;
      const content = Buffer.concat(session.chunks.map(chunk => chunk.bytes));
      items.set(id, { id, name: session.name, size: content.length, file: { mimeType: options.headers['Content-Type'] },
        parentReference: { id: FOLDER }, description: session.item.description, content });
      return json({ id, name: session.name }, 201);
    }
    const match = /\/me\/drive\/items\/([^/?]+)(\/content)?/.exec(url);
    if (match) {
      const item = items.get(decodeURIComponent(match[1]));
      if (!item) return json({}, 404);
      if (match[2]) return { ok: true, status: 200, headers: new Headers({ 'content-length': String(item.content.length) }), body: new Blob([item.content]).stream() };
      const { content, ...metadata } = item; return json(metadata);
    }
    throw new Error(`Unexpected request ${url}`);
  });
  const refreshFirebaseOwner = async (refreshToken, { uid }) => ({ uid, email: config.ownerEmail, idToken: 'refreshed-id-token', refreshToken: 'firebase-refresh-token' });
  const options = { vault, config: { ...config, ...overrides.config }, fetcher, refreshFirebaseOwner,
    captureSnapshot: overrides.captureSnapshot, captureBackup: async () => Buffer.from('ZIP-private-originals') };
  return { records, items, sessions, calls, options, create: () => createFreeOneDrive(options) };
}

async function connect(f, drive = f.create(), expectRedirect = true) {
  const started = response();
  await drive.start({ user: owner, body: { firebaseRefreshToken: 'firebase-refresh-token' } }, started);
  const authorization = new URL(started.body.url);
  const result = response();
  await drive.callback({ query: { state: authorization.searchParams.get('state'), code: 'authorization-code' } }, result);
  if (expectRedirect) assert.equal(result.redirectURL, 'https://career.example.app/?connected=drive');
  return { drive, authorization, result };
}

test('storage IDs accept Google Drive and OneDrive personal formats only', () => {
  assert.ok(validGoogleDriveId('1AbC_def-GHIjkl'));
  assert.ok(validOneDriveItemId('ABCDEF0123456789!1234'));
  assert.ok(validStorageFileId('ABCDEF0123456789!1234') && validStorageFileId('1AbC_def-GHIjkl'));
  for (const bad of ['short', '../../../etc', 'a/b/c/d/e/f', 'ABC!12..34', 'x'.repeat(260), 42]) assert.equal(validStorageFileId(bad), false, String(bad));
  assert.equal(oneDriveName('a:b*c?.'), 'a_b_c_');
});

test('OneDrive stays disabled without HTTPS root URL, owner or Microsoft credentials', async () => {
  for (const missing of [{ appUrl: 'http://career.example.app' }, { ownerEmail: '' }, { microsoftClientId: '' }, { microsoftClientSecret: '' }, { driveEnabled: false }]) {
    const drive = fixture({ config: missing }).create();
    assert.equal(drive.configured, false);
    assert.deepEqual(await drive.scheduled(), { skipped: 'drive-not-configured' });
  }
});

test('start → callback uses PKCE against the consumers authority and stores an encrypted-vault refresh token', async () => {
  const f = fixture();
  const { drive, authorization } = await connect(f);
  assert.equal(authorization.origin + authorization.pathname, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  assert.equal(authorization.searchParams.get('redirect_uri'), 'https://career.example.app/api/auth/onedrive/callback');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorization.searchParams.get('scope'), /offline_access .*Files\.ReadWrite\.AppFolder/);
  const exchange = new URLSearchParams(f.calls.find(call => call.url.endsWith('/token')).options.body);
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.equal(exchange.get('client_secret'), 'ms-secret');
  assert.ok(exchange.get('code_verifier'));
  const tokens = f.records.get('oneDriveTokens/owner-uid');
  assert.equal(tokens.refresh_token, 'ms-refresh-1');
  assert.equal(tokens.accountId, 'ms-account-1');
  assert.equal(tokens.accountEmail, 'personal@outlook.com');
  assert.deepEqual(f.records.get('configuredOwner'), { uid: 'owner-uid', email: config.ownerEmail });
  const state = await drive.status(owner);
  assert.equal(state.driveConnected, true);
  assert.equal(state.storageProvider, 'onedrive');
  assert.equal(state.storageAccount, 'personal@outlook.com');
});

test('a reused or Google-provider OAuth state is rejected', async () => {
  const f = fixture();
  const { drive, authorization } = await connect(f);
  const replay = response();
  await drive.callback({ query: { state: authorization.searchParams.get('state'), code: 'authorization-code' } }, replay);
  assert.equal(replay.statusCode, 400);
  f.records.set(`oauthStates/${createHash('sha256').update('a'.repeat(64)).digest('hex')}`, { uid: 'owner-uid', email: config.ownerEmail, verifier: 'v', expiresAt: Date.now() + 60000 });
  const google = response();
  await drive.callback({ query: { state: 'a'.repeat(64), code: 'c' } }, google);
  assert.equal(google.statusCode, 400);
});

test('callback refuses a missing app-folder grant, a different owner, and switching Microsoft accounts', async () => {
  const noScope = fixture({ scope: 'User.Read openid' });
  const { result } = await connect(noScope, undefined, false);
  assert.equal(result.statusCode, 403);
  assert.equal(noScope.records.has('oneDriveTokens/owner-uid'), false);

  const stranger = fixture();
  const started = response();
  await assert.rejects(stranger.create().start({ user: { ...owner, email: 'other@example.com' }, body: { firebaseRefreshToken: 'x' } }, started), /본인/);

  const f = fixture();
  await connect(f);
  await f.create().access({ user: owner }, response());
  const other = fixture({ accountId: 'ms-account-2' });
  for (const [key, value] of f.records) other.records.set(key, value);
  const switched = await connect(other, undefined, false);
  assert.equal(switched.result.statusCode, 403);
  assert.match(switched.result.body, /처음 연결한 마이크로소프트 계정/);
});

test('expired access tokens are refreshed and the rotated refresh token is kept', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  f.records.set('oneDriveTokens/owner-uid', { ...f.records.get('oneDriveTokens/owner-uid'), expiresAt: Date.now() - 1 });
  const res = response();
  await drive.access({ user: owner }, res);
  assert.equal(res.body.accessToken, 'graph-access-2');
  assert.equal(res.body.folderId, FOLDER);
  assert.equal(res.body.provider, 'onedrive');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(f.records.get('oneDriveTokens/owner-uid').refresh_token, 'ms-refresh-2');
  const refresh = new URLSearchParams(f.calls.filter(call => call.url.endsWith('/token')).at(-1).options.body);
  assert.equal(refresh.get('grant_type'), 'refresh_token');
  assert.equal(refresh.get('refresh_token'), 'ms-refresh-1');
});

test('small and large uploads use one upload session with archive metadata, and reads verify integrity', async () => {
  const f = fixture();
  const { drive } = await connect(f);
  const small = Buffer.from('%PDF-1.7 small document');
  const stored = await drive.upload('owner-uid', small, '공문:1?.pdf', 'application/pdf', 'document');
  assert.match(stored.driveFileId, /!/);
  assert.equal(f.items.get(stored.driveFileId).name, '공문_1_.pdf');
  const meta = decodeArchiveDescription(f.items.get(stored.driveFileId).description);
  assert.deepEqual(meta, { archiveUid: 'owner-uid', kind: 'document', sha256: createHash('sha256').update(small).digest('hex') });

  const large = Buffer.alloc(UPLOAD_CHUNK_BYTES * 2 + 1234, 7);
  const big = await drive.upload('owner-uid', large, 'backup.zip', 'application/zip', 'backup');
  const session = [...f.sessions.values()].at(-1);
  assert.deepEqual(session.chunks.map(chunk => chunk.range), [
    `bytes 0-${UPLOAD_CHUNK_BYTES - 1}/${large.length}`,
    `bytes ${UPLOAD_CHUNK_BYTES}-${UPLOAD_CHUNK_BYTES * 2 - 1}/${large.length}`,
    `bytes ${UPLOAD_CHUNK_BYTES * 2}-${large.length - 1}/${large.length}`,
  ]);
  assert.equal(f.items.get(big.driveFileId).content.length, large.length);

  const read = await readDriveFile(drive, f.options.fetcher, 'owner-uid', stored.driveFileId, { kind: 'document', size: small.length });
  assert.deepEqual(read.buffer, small);
  await assert.rejects(readDriveFile(drive, f.options.fetcher, 'owner-uid', big.driveFileId, { kind: 'document' }), /원본 파일이 아닙니다|25MB/);
  f.items.get(stored.driveFileId).description = JSON.stringify({ v: 1, archiveUid: 'someone-else', kind: 'document' });
  await assert.rejects(drive.requireFile('owner-uid', stored.driveFileId, { kind: 'document' }), /원본 파일이 아닙니다/);
  await assert.rejects(drive.requireFile('owner-uid', '1GoogleDriveId_abc', { kind: 'document' }), /찾지 못했습니다/);
  await assert.rejects(drive.upload('owner-uid', Buffer.alloc(0), 'empty.txt', 'text/plain', 'document'), /빈 파일/);
});

test('status reports the last backup; disconnect keeps the account binding but stops scheduled backups', async () => {
  const f = fixture({ captureSnapshot: async () => Buffer.from(JSON.stringify({ careers: [] })) });
  const { drive } = await connect(f);
  const done = await drive.scheduled();
  assert.equal(done.results[0].ok, true);
  assert.equal(done.results[0].lastBackupKind, 'snapshot');
  assert.match(f.items.get(done.results[0].driveFileId).name, /^career-snapshot-.*\.json$/);
  assert.equal((await drive.status(owner)).lastBackup, done.results[0].lastBackup);

  const res = response();
  await drive.disconnect({ user: owner }, res);
  assert.deepEqual(res.body, { ok: true, revoked: false });
  assert.deepEqual(f.records.get('oneDriveTokens/owner-uid'), { accountId: 'ms-account-1', accountEmail: 'personal@outlook.com' });
  assert.equal((await drive.status(owner)).driveConnected, false);
  assert.deepEqual(await drive.scheduled(), { skipped: 'drive-not-connected' });
});

test('scheduled backup failures are recorded for the owner without throwing', async () => {
  const f = fixture({ captureSnapshot: async () => Buffer.from('not json') });
  const { drive } = await connect(f);
  const result = await drive.scheduled();
  assert.equal(result.results[0].ok, false);
  assert.match(f.records.get('backupError/owner-uid'), /형식/);
  assert.deepEqual(await fixture().create().scheduled(), { skipped: 'owner-not-connected' });
});
