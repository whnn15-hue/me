import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFreeOneDrive } from '../server/free/onedrive.mjs';
import { createOneDriveMigration, migrationCounts } from '../server/free/storage-migration.mjs';
import { createFreeApi } from '../server/free/api.mjs';
import { planFileIdSwap } from '../shared/storage-migration.mjs';
import { validOneDriveItemId } from '../shared/storage-id.mjs';

const config = { appUrl: 'https://career.example.app', ownerEmail: 'owner@example.com', projectId: 'career-test', firebaseWebApiKey: 'public-key',
  driveEnabled: true, googleClientId: 'google-client', googleClientSecret: 'google-secret', microsoftClientId: 'ms-client', microsoftClientSecret: 'ms-secret', storageProvider: 'google' };
const owner = { uid: 'owner-uid', email: config.ownerEmail, name: 'Owner', token: 'verified-firebase-id-token' };
const FOLDER = 'AF91D1708B3A5395!s00000000000000000000000000000001';
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const stream = content => ({ ok: true, status: 200, headers: new Headers({ 'content-length': String(content.length) }), body: new Blob([content]).stream() });
const response = () => ({ statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
  status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; },
  send(value) { this.body = value; return this; }, redirect(value) { this.redirectURL = value; return this; } });

function fixture({ files = 3, onOneDrive = 1, corrupt = [], clock } = {}) {
  const records = new Map(), leases = new Map(), items = new Map(), sessions = new Map();
  const stats = { sessions: 0, googleReads: 0 }; let sequence = 0, tokenCount = 0;
  const vault = {
    getJSON: async key => structuredClone(records.get(key) ?? null),
    setJSON: async (key, value) => { records.set(key, structuredClone(value)); },
    deleteJSON: async key => { records.delete(key); },
    consumeJSON: async key => { const value = structuredClone(records.get(key) ?? null); records.delete(key); return value; },
    acquireLease: async key => {
      if (leases.has(key)) throw Object.assign(new Error('작업이 이미 진행 중입니다.'), { status: 409 });
      const lease = {}; leases.set(key, lease); return async () => { if (leases.get(key) === lease) leases.delete(key); };
    },
  };
  // Google Drive provider fake with the same requireFile contract.
  const google = new Map(), documents = [];
  for (let index = 0; index < files; index++) {
    const content = Buffer.from(`original ${index} `.repeat(50 + index));
    const id = `googleFile${String(index).padStart(6, '0')}`;
    google.set(id, { content, declared: corrupt.includes(index) ? sha(Buffer.from('other')) : sha(content) });
    documents.push({ id: `doc-${index}`, name: `공문 ${index}.pdf`, mime: 'application/pdf', size: content.length, sha256: sha(content), driveFileId: id });
  }
  for (let index = 0; index < onOneDrive; index++) documents.push({ id: `already-${index}`, name: 'x.pdf', size: 1, sha256: 'a'.repeat(64), driveFileId: `AF91D1708B3A5395!s${'f'.repeat(31)}${index}` });
  const drive = { provider: 'google', configured: true, async requireFile(uid, id, { kind } = {}) {
    stats.googleReads++;
    const file = google.get(id); if (!file) throw Object.assign(new Error('missing'), { status: 404 });
    return { metadata: { id, name: `${id}.pdf`, mimeType: 'application/pdf', size: String(file.content.length), appProperties: { archiveUid: uid, kind, sha256: file.declared } }, download: async () => stream(file.content) };
  } };
  const fetcher = async (url, options = {}) => {
    if (url.endsWith('/oauth2/v2.0/token')) { tokenCount++; return json({ access_token: `graph-access-${tokenCount}`, refresh_token: `ms-refresh-${tokenCount}`, expires_in: 3600, scope: 'Files.ReadWrite.AppFolder User.Read' }); }
    if (url.includes('/v1.0/me?')) return json({ id: 'ms-account-1', userPrincipalName: 'person@example.com' });
    if (url.includes('/special/approot')) return json({ id: FOLDER, name: 'Apps' });
    if (url.includes('/children?')) return json({ value: [...items.values()].map(({ content, ...item }) => item) });
    if (url.endsWith(':/createUploadSession')) {
      stats.sessions++; const uploadUrl = `https://api.onedrive.com/rup/session-${++sequence}`;
      sessions.set(uploadUrl, { name: decodeURIComponent(url.split(':/').at(-2)), item: JSON.parse(options.body).item, chunks: [] }); return json({ uploadUrl });
    }
    if (url.startsWith('https://api.onedrive.com/rup/')) {
      const session = sessions.get(url); if (options.method === 'DELETE') return json({}, 204);
      session.chunks.push(Buffer.from(options.body));
      const total = Number(options.headers['Content-Range'].split('/')[1]), content = Buffer.concat(session.chunks);
      if (content.length < total) return json({}, 202);
      const id = `AF91D1708B3A5395!s${String(++sequence).padStart(32, '0')}`;
      items.set(id, { id, name: session.name, size: content.length, file: { mimeType: 'application/pdf' }, parentReference: { id: FOLDER }, description: session.item.description, content });
      return json({ id, name: session.name }, 201);
    }
    const match = /\/me\/drive\/items\/([^/?]+)(\/content)?/.exec(url);
    if (match) { const item = items.get(decodeURIComponent(match[1])); if (!item) return json({}, 404); if (match[2]) return stream(item.content); const { content, ...metadata } = item; return json(metadata); }
    throw new Error(`Unexpected request ${url}`);
  };
  const refreshFirebaseOwner = async (token, { uid }) => ({ uid, email: config.ownerEmail, idToken: 'refreshed', refreshToken: 'firebase-refresh' });
  const oneDrive = createFreeOneDrive({ vault, config, fetcher, refreshFirebaseOwner, captureBackup: async () => Buffer.from('zip') });
  const state = { documents };
  const repoFor = () => ({ snapshot: async () => ({ documents: structuredClone(state.documents), careers: [], workspace: { items: [] } }) });
  const make = (extra = {}) => createOneDriveMigration({ config: { ...config, ...extra }, vault, drive, oneDrive, fetcher, repoFor, ...(clock ? { now: clock } : {}) });
  // Applies a mapping like the browser's revision-checked transaction would.
  const apply = mapping => { const { updates } = planFileIdSwap(state.documents, mapping); const byId = new Map(updates.map(item => [item.id, item])); state.documents = state.documents.map(item => byId.get(item.id) || item); return updates.length; };
  return { vault, records, items, stats, oneDrive, state, make, apply, leases };
}
async function connectOneDrive(f, migration = f.make()) {
  const started = response();
  await migration.start({ user: owner, body: { firebaseRefreshToken: 'firebase-refresh' } }, started);
  const state = new URL(started.body.url).searchParams.get('state'), done = response();
  await migration.callback({ query: { state, code: 'authorization-code' } }, done);
  assert.equal(done.redirectURL, 'https://career.example.app/?connected=drive');
  return migration;
}

test('full migration copies, verifies and maps every Google original exactly once', async () => {
  const f = fixture(); const migration = await connectOneDrive(f);
  const before = await migration.status(owner);
  assert.deepEqual(before.counts, { total: 4, onOneDrive: 1, copied: 0, pending: 3, failed: 0 }); assert.equal(before.connected, true);
  const step = await migration.step(owner);
  assert.equal(step.processed, 3); assert.equal(Object.keys(step.mapping).length, 3); assert.equal(f.stats.sessions, 3);
  for (const [googleId, target] of Object.entries(step.mapping)) {
    assert.ok(validOneDriveItemId(target.id)); const document = f.state.documents.find(item => item.driveFileId === googleId);
    assert.equal(target.sha256, document.sha256); assert.equal(sha(f.items.get(target.id).content), document.sha256);
  }
  assert.equal(f.apply(step.mapping), 3);
  const after = await migration.step(owner);
  assert.equal(after.done, true); assert.equal(after.processed, 0); assert.deepEqual(after.counts, { total: 4, onOneDrive: 4, copied: 0, pending: 0, failed: 0 });
  assert.equal(f.stats.sessions, 3, 'no file is uploaded twice');
  assert.ok(!JSON.stringify([...f.records.entries()].filter(([key]) => key.startsWith('migration/'))).includes('original 0'), 'ledger holds no file content');
});

test('a crash after upload or before the record update resumes without a second upload', async () => {
  const f = fixture({ files: 2, onOneDrive: 0 }); const migration = await connectOneDrive(f);
  // Crash right after the upload finishes, before the ledger learns its ID.
  const upload = f.oneDrive.upload; let crashOnce = true;
  f.oneDrive.upload = async (...args) => { const result = await upload(...args); if (crashOnce) { crashOnce = false; throw new Error('process died'); } return result; };
  const crashed = await migration.step(owner);
  assert.equal(crashed.counts.failed, 1); assert.equal(f.stats.sessions, 2);
  const ledger = f.records.get('migration/onedrive/owner-uid');
  assert.equal(Object.values(ledger.files).filter(entry => entry.state === 'uploading').length, 1, 'ledger only knows the upload started');
  const resumed = await migration.step(owner, { retryFailed: true });
  assert.equal(f.stats.sessions, 2, 'the interrupted copy is found in the app folder by SHA-256, not uploaded again');
  assert.equal(Object.keys(resumed.mapping).length, 2);
  // The browser never applied the mapping (tab closed): the next step only re-reports it.
  const again = await migration.step(owner);
  assert.equal(again.processed, 0); assert.deepEqual(again.mapping, resumed.mapping); assert.equal(f.stats.sessions, 2);
  assert.equal(f.apply(again.mapping), 2); assert.equal((await migration.step(owner)).done, true);
});

test('record swaps only touch unchanged records with the verified bytes', () => {
  const docs = [
    { id: 'a', driveFileId: 'googleFile000001', sha256: 'a'.repeat(64), size: 10 },
    { id: 'b', driveFileId: 'googleFile000002', sha256: 'b'.repeat(64), size: 10 },
    { id: 'c', driveFileId: 'AF91D1708B3A5395!s' + '1'.repeat(32), sha256: 'c'.repeat(64), size: 10 },
  ];
  const mapping = {
    googleFile000001: { id: 'AF91D1708B3A5395!s' + '2'.repeat(32), sha256: 'a'.repeat(64), size: 10 },
    googleFile000002: { id: 'AF91D1708B3A5395!s' + '3'.repeat(32), sha256: 'd'.repeat(64), size: 10 }, // replaced meanwhile
  };
  const { updates, skipped } = planFileIdSwap(docs, mapping);
  assert.deepEqual(updates.map(item => [item.id, item.driveFileId]), [['a', mapping.googleFile000001.id]]);
  assert.deepEqual(skipped, ['b']);
  assert.deepEqual(planFileIdSwap(docs, { googleFile000001: { id: '../../escape', sha256: 'a'.repeat(64) } }).updates, []);
});

test('integrity mismatch is recorded as a failure and keeps the Google ID', async () => {
  const f = fixture({ files: 2, onOneDrive: 0, corrupt: [1] }); const migration = await connectOneDrive(f);
  const step = await migration.step(owner);
  assert.equal(step.counts.failed, 1); assert.equal(Object.keys(step.mapping).length, 1); assert.equal(step.done, false);
  assert.match(step.failures[0].message, /무결성/); assert.equal(step.failures[0].documentId, 'doc-1');
  f.apply(step.mapping); assert.equal(f.state.documents[1].driveFileId, 'googleFile000001');
  const skipped = await migration.step(owner); assert.equal(skipped.processed, 0, 'failures wait for an explicit retry');
  const retried = await migration.step(owner, { retryFailed: true }); assert.equal(retried.counts.failed, 1);
});

test('a second tab cannot run a step at the same time', async () => {
  const f = fixture(); const migration = await connectOneDrive(f);
  const release = await f.vault.acquireLease('migration/owner-uid');
  await assert.rejects(migration.step(owner), { status: 409 }); assert.equal(f.stats.sessions, 0);
  await release(); assert.equal((await migration.step(owner)).processed, 3);
});

test('after switching to OneDrive the migration is a no-op', async () => {
  const f = fixture(); const migration = f.make({ storageProvider: 'onedrive' });
  assert.deepEqual(await migration.step(owner), { switched: true }); assert.deepEqual(await migration.status(owner), { switched: true, available: false });
  const started = response(); await migration.start({ user: owner, body: {} }, started); assert.deepEqual(started.body, { switched: true });
  assert.equal(f.stats.googleReads, 0);
});

test('a step stops starting new files when its time budget runs out', async () => {
  let time = 0; const f = fixture({ files: 3, onOneDrive: 0, clock: () => time });
  const migration = await connectOneDrive(f);
  const slowRead = f.oneDrive.upload; f.oneDrive.upload = async (...args) => { time += 20000; return slowRead(...args); };
  const step = await migration.step(owner, {}, { budgetMs: 40000, reserveMs: 15000 });
  assert.equal(step.processed, 2); assert.equal(step.stoppedForTime, true); assert.equal(step.counts.pending, 1);
});

test('migration needs a connected OneDrive and reports counts safely', async () => {
  const f = fixture(); const migration = f.make();
  await assert.rejects(migration.step(owner), /OneDrive를 연결/);
  assert.deepEqual(migrationCounts(f.state.documents, { files: {}, failures: {} }), { total: 4, onOneDrive: 1, copied: 0, pending: 3, failed: 0 });
});

test('API exposes migration only while Google Drive is active and routes the OneDrive callback', async () => {
  const auth = { identify: async () => owner, refreshFirebaseOwner: async () => null };
  const vault = { getJSON: async () => null, setJSON: async () => {}, deleteJSON: async () => {}, consumeJSON: async () => null, acquireLease: async () => async () => {} };
  const google = createFreeApi({ config, vault, auth, fetcher: async () => { throw new Error('no network'); } });
  const status = await (await google.handle(new Request('https://career.example.app/api/status'))).json();
  assert.equal(status.oneDriveMigrationAvailable, true); assert.equal(status.storageProvider, 'google');
  const callback = await google.handle(new Request('https://career.example.app/api/auth/onedrive/callback?state=bad'));
  assert.equal(callback.status, 400, 'the callback is handled by the migration connection, not a 404');
  const switched = createFreeApi({ config: { ...config, storageProvider: 'onedrive' }, vault, auth, fetcher: async () => { throw new Error('no network'); } });
  assert.equal((await (await switched.handle(new Request('https://career.example.app/api/status'))).json()).oneDriveMigrationAvailable, false);
  const noMicrosoft = createFreeApi({ config: { ...config, microsoftClientId: '' }, vault, auth, fetcher: async () => { throw new Error('no network'); } });
  assert.equal((await (await noMicrosoft.handle(new Request('https://career.example.app/api/status'))).json()).oneDriveMigrationAvailable, false);
});
