import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFreeOneDrive, UPLOAD_CHUNK_BYTES, decodeArchiveDescription, oneDriveName } from '../server/free/onedrive.mjs';
import { readDriveFile } from '../server/free/files.mjs';
import { validGoogleDriveId, validOneDriveItemId, validStorageFileId } from '../shared/storage-id.mjs';
// Same encoding real OneDrive Personal applies to descriptions it returns.
const oneDriveEncoded = text => String(text).replace(/[{}":]/g, c => ({ '{': '&#123;', '}': '&#125;', '"': '&quot;', ':': '&#58;' })[c]);

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
    const intercepted = await overrides.intercept?.(url, options);
    if (intercepted !== undefined) return intercepted;
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
      if (JSON.parse(options.body).item?.description !== undefined) return json({ error: { code: 'invalidRequest', message: 'Invalid request' } }, 400);
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
        parentReference: { id: FOLDER }, content });
      return json({ id, name: session.name }, 201);
    }
    const match = /\/me\/drive\/items\/([^/?]+)(\/content)?/.exec(url);
    if (match) {
      const item = items.get(decodeURIComponent(match[1]));
      if (!item) return json({}, 404);
      if (options.method === 'PATCH') { item.description = oneDriveEncoded(JSON.parse(options.body).description); return json({ id: item.id }); }
      if (options.method === 'DELETE') { items.delete(item.id); return json({}, 204); }
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
  // Format observed on a real personal account on 2026-11-11 (new-style item IDs).
  assert.ok(validOneDriveItemId('AF91D1708B3A5395!sc72cd4398c0649d5b37282030bfcb165'));
  assert.ok(validStorageFileId('AF91D1708B3A5395!s7085ee9ba1a04d3e9561d24f6eb7e9e4'));
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

test('a cached token rejected by Graph is renewed once and the newest credentials are returned', async () => {
  let folders = 0;
  const f = fixture({ intercept: (url) => url.includes('/special/approot') && ++folders === 1 ? json({ error: { message: 'private provider body' } }, 401) : undefined });
  const { drive } = await connect(f);
  const res = response(); await drive.access({ user: owner }, res);
  assert.equal(folders, 2);
  assert.equal(res.body.accessToken, 'graph-access-2');
  assert.equal(f.records.get('oneDriveTokens/owner-uid').refresh_token, 'ms-refresh-2');
  assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 2);
  assert.equal((await drive.status(owner)).driveConnected, true);
  assert.equal(f.records.has('oneDriveAuthState/owner-uid'), false);
});

test('repeated Graph 401 stops after one renewal and never diagnoses refresh-token revocation', async () => {
  const f = fixture({ intercept: url => url.includes('/special/approot') ? json({ error: { message: 'private provider body' } }, 401) : undefined });
  const { drive } = await connect(f);
  await assert.rejects(drive.access({ user: owner }, response()), error => error.status === 502 && /폴더 확인, HTTP 401/.test(error.message) && !error.message.includes('private'));
  assert.equal(f.calls.filter(call => call.url.includes('/special/approot')).length, 2);
  assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 2);
  assert.equal(f.records.has('oneDriveAuthState/owner-uid'), false);
  assert.equal((await drive.status(owner)).driveConnected, true);
});

test('explicit renewal accepts only boolean true and still requires the owner', async () => {
  const f = fixture(); const { drive } = await connect(f);
  await drive.access({ user: owner, body: { forceRefresh: 'true' } }, response());
  assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 1);
  const res = response(); await drive.access({ user: owner, body: { forceRefresh: true } }, res);
  assert.equal(res.body.accessToken, 'graph-access-2');
  const before = f.calls.length;
  await assert.rejects(drive.access({ user: { ...owner, email: 'stranger@example.com' }, body: { forceRefresh: true } }, response()), /본인/);
  assert.equal(f.calls.length, before);
});

test('a newer rotated token in the vault is reused instead of refreshing the rejected token again', async () => {
  let rejected = false;
  const f = fixture({ intercept: (url) => {
    if (url.includes('/special/approot') && !rejected) {
      rejected = true;
      f.records.set('oneDriveTokens/owner-uid', { ...f.records.get('oneDriveTokens/owner-uid'), access_token: 'already-rotated-access', refresh_token: 'already-rotated-refresh' });
      return json({}, 401);
    }
  } });
  const { drive } = await connect(f); const res = response();
  await drive.access({ user: owner }, res);
  assert.equal(res.body.accessToken, 'already-rotated-access');
  assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 1);
  assert.equal(f.records.get('oneDriveTokens/owner-uid').refresh_token, 'already-rotated-refresh');
});

test('rejected upload-session creation refreshes Graph once before sending any original bytes', async () => {
  let starts = 0;
  const f = fixture({ intercept: (url) => url.endsWith(':/createUploadSession') && ++starts === 1 ? json({}, 401) : undefined });
  const { drive } = await connect(f);
  const stored = await drive.upload('owner-uid', Buffer.from('original'), 'original.pdf', 'application/pdf', 'document');
  assert.equal(starts, 2); assert.equal(f.sessions.size, 1); assert.equal(f.items.size, 1);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://api.onedrive.com/rup/') && call.options.method === 'PUT').length, 1);
  assert.equal(f.items.get(stored.driveFileId).description.includes('document'), true);
  assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 2);
});

test('a metadata PATCH 401 renews credentials without creating or uploading another file', async () => {
  let labels = 0;
  const f = fixture({ intercept: (_url, options) => options.method === 'PATCH' && ++labels === 1 ? json({}, 401) : undefined });
  const { drive } = await connect(f);
  const stored = await drive.upload('owner-uid', Buffer.from('original'), 'original.pdf', 'application/pdf', 'document');
  assert.equal(labels, 2); assert.equal(f.sessions.size, 1); assert.equal(f.items.size, 1);
  assert.equal(f.calls.filter(call => call.options.method === 'PUT').length, 1);
  assert.equal(f.calls.filter(call => call.options.method === 'DELETE').length, 0);
  assert.equal(f.calls.filter(call => call.options.method === 'PATCH').at(-1).options.headers.Authorization, 'Bearer graph-access-2');
  assert.equal(decodeArchiveDescription(f.items.get(stored.driveFileId).description).kind, 'document');
});

test('expired upload sessions are distinct from account authorization and preserve the last backup', async () => {
  for (const status of [401, 404, 410]) {
    const f = fixture({ captureSnapshot: async () => Buffer.from('{"careers":[]}'), intercept: (url, options) => url.startsWith('https://api.onedrive.com/rup/') && options.method === 'PUT' ? json({ private: 'provider upload token' }, status) : undefined });
    const { drive } = await connect(f);
    f.records.set('lastBackup/owner-uid', 'previous-success');
    f.records.set('lastBackupKind/owner-uid', 'snapshot');
    await assert.rejects(drive.backup(owner), error => error.status === 502 && /업로드 세션/.test(error.message) && error.message.includes(`HTTP ${status}`));
    assert.equal(f.records.get('lastBackup/owner-uid'), 'previous-success');
    assert.equal(f.records.get('lastBackupKind/owner-uid'), 'snapshot');
    assert.match(f.records.get('backupError/owner-uid'), /업로드 세션/);
    assert.equal(f.records.has('oneDriveAuthState/owner-uid'), false);
    assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 1);
    assert.equal(f.calls.filter(call => call.options.method === 'PUT').length, 1);
    assert.equal((await drive.status(owner)).driveConnected, true);
    assert.ok(f.calls.filter(call => call.url.startsWith('https://api.onedrive.com/rup/')).every(call => !call.options.headers?.Authorization));
    assert.ok(!f.records.get('backupError/owner-uid').includes('provider upload token'));
  }
});

test('upload timeouts retain a useful stage and never invalidate a working account', async () => {
  for (const failure of [Object.assign(new Error('private URL'), { name: 'TimeoutError' }), Object.assign(new Error('private URL'), { status: 504 })]) {
    const f = fixture({ captureSnapshot: async () => Buffer.from('{"careers":[]}'), intercept: (url, options) => { if (url.startsWith('https://api.onedrive.com/rup/') && options.method === 'PUT') throw failure; } });
    const { drive } = await connect(f);
    f.records.set('lastBackup/owner-uid', 'previous-success');
    await assert.rejects(drive.backup(owner), error => error.status === 504 && /대기 시간이 초과.*파일 전송/.test(error.message));
    assert.equal(f.records.get('lastBackup/owner-uid'), 'previous-success');
    assert.ok(!f.records.get('backupError/owner-uid').includes('private URL'));
    assert.equal((await drive.status(owner)).driveConnected, true);
    assert.equal(f.records.has('oneDriveAuthState/owner-uid'), false);
  }
});

test('only a rejected refresh grant marks reconnection required, preserving files and account binding', async () => {
  for (const code of ['invalid_grant', 'interaction_required']) {
    let rejectRefresh = false;
    const f = fixture({ intercept: (url, options) => url.endsWith('/token') && new URLSearchParams(options.body).get('grant_type') === 'refresh_token' && rejectRefresh ? json({ error: code, error_description: 'private refresh-token and request details' }, 400) : undefined });
    const { drive } = await connect(f);
    await drive.upload('owner-uid', Buffer.from('keep original'), 'keep.pdf', 'application/pdf', 'document');
    const savedTokens = structuredClone(f.records.get('oneDriveTokens/owner-uid'));
    const account = structuredClone(f.records.get('configuredOwner'));
    const folder = f.records.get('oneDriveFolder/owner-uid');
    rejectRefresh = true;
    await assert.rejects(drive.access({ user: owner, body: { forceRefresh: true } }, response()), error => error.status === 409 && /처음 연결한 마이크로소프트 계정/.test(error.message) && !error.message.includes('private'));
    const status = await drive.status(owner);
    assert.equal(status.storageReconnectRequired, true); assert.equal(status.driveConnected, false);
    assert.deepEqual(f.records.get('oneDriveTokens/owner-uid'), savedTokens);
    assert.deepEqual(f.records.get('configuredOwner'), account);
    assert.equal(f.records.get('oneDriveFolder/owner-uid'), folder); assert.equal(f.items.size, 1);
    assert.deepEqual(f.records.get('oneDriveAuthState/owner-uid'), { reconnectRequired: true, code });
    rejectRefresh = false;
    const refreshed = response(); await drive.access({ user: owner, body: { forceRefresh: true } }, refreshed);
    assert.equal((await drive.status(owner)).driveConnected, true);
    assert.equal(f.records.has('oneDriveAuthState/owner-uid'), false);
    f.records.set('oneDriveAuthState/owner-uid', { reconnectRequired: true, code });
    await connect(f, drive);
    assert.equal(f.records.has('oneDriveAuthState/owner-uid'), false);
    assert.equal(f.items.size, 1);
  }
});

test('temporary refresh failures and server credential errors do not mark the owner disconnected', async () => {
  for (const [status, code] of [[429, 'temporarily_unavailable'], [503, 'server_error'], [400, 'invalid_client']]) {
    const f = fixture({ intercept: (url, options) => url.endsWith('/token') && new URLSearchParams(options.body).get('grant_type') === 'refresh_token' ? json({ error: code, error_description: 'private token contents' }, status) : undefined });
    const { drive } = await connect(f); const before = structuredClone(f.records.get('oneDriveTokens/owner-uid'));
    await assert.rejects(drive.access({ user: owner, body: { forceRefresh: true } }, response()), error => !error.message.includes('private') && (code === 'invalid_client' ? /서버 연결 설정/.test(error.message) && error.status === 503 : error.message.includes(`HTTP ${status}`)));
    assert.deepEqual(f.records.get('oneDriveTokens/owner-uid'), before);
    assert.equal(f.records.has('oneDriveAuthState/owner-uid'), false);
    assert.equal((await drive.status(owner)).driveConnected, true);
  }
});

test('a metadata read can renew a rejected token after its folder lease is released', async () => {
  let rejectMetadata = false;
  const f = fixture({ intercept: (url, options) => {
    if (rejectMetadata && url.includes('/me/drive/items/') && url.includes('?$select=') && !options.method) { rejectMetadata = false; return json({}, 401); }
  } });
  const { drive } = await connect(f);
  const stored = await drive.upload('owner-uid', Buffer.from('keep'), 'read.pdf', 'application/pdf', 'document');
  rejectMetadata = true;
  const file = await drive.requireFile('owner-uid', stored.driveFileId, { kind: 'document' });
  assert.equal(file.accessToken, 'graph-access-2');
  assert.equal(file.metadata.id, stored.driveFileId);
  assert.equal(f.records.get('oneDriveTokens/owner-uid').refresh_token, 'ms-refresh-2');
});

test('full backup reads renew inside the existing lease and later upload reuses that rotated token', async () => {
  let rejectOldToken = false, drive, documentId;
  const f = fixture({ intercept: (url, options) => rejectOldToken && url.startsWith('https://graph.microsoft.com/v1.0/') && options.headers?.Authorization === 'Bearer graph-access-1' ? json({}, 401) : undefined });
  f.options.captureBackup = async (uid, { driveAccessToken }) => {
    const file = await drive.requireFile(uid, documentId, { kind: 'document', driveAccessToken });
    assert.equal(file.accessToken, 'graph-access-2');
    return Buffer.from('ZIP-originals-preserved');
  };
  ({ drive } = await connect(f));
  documentId = (await drive.upload('owner-uid', Buffer.from('keep original'), 'keep.pdf', 'application/pdf', 'document')).driveFileId;
  rejectOldToken = true;
  const backup = await drive.backup(owner);
  assert.equal(backup.ok, true); assert.equal(backup.lastBackupKind, 'full');
  assert.equal(f.items.size, 2); assert.ok(f.items.has(documentId));
  assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 2, 'one refresh, then reuse the token already rotated while reading');
  assert.equal(f.records.get('oneDriveTokens/owner-uid').refresh_token, 'ms-refresh-2');
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
