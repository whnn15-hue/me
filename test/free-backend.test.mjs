import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';
import { createPrivateVault } from '../server/free/vault.mjs';
import { createFreeAuth } from '../server/free/auth.mjs';
import { FreeRestRepository, decodeFields } from '../server/free/repository.mjs';
import { createFreeApi } from '../server/free/api.mjs';
import { createDriveBackup, sha256 } from '../server/free/files.mjs';
import { normalizeCareer } from '../server/store.mjs';
import JSZip from 'jszip';
import { serializeDriveSnapshot } from '../server/free/snapshot.mjs';
import { budgetedFetch, runWithDeadline } from '../server/free/deadline.mjs';

class MemoryBlobs {
  constructor() { this.values = new Map(); this.generation = 0; }
  async get(name) { return structuredClone(this.values.get(name)?.data || null); }
  async getWithMetadata(name) { const row = this.values.get(name); return row ? structuredClone(row) : null; }
  async setJSON(name, data, conditions = {}) {
    const previous = this.values.get(name);
    if (conditions.onlyIfNew && previous || conditions.onlyIfMatch && conditions.onlyIfMatch !== previous?.etag) return { modified: false };
    const etag = String(++this.generation); this.values.set(name, { data: structuredClone(data), etag, metadata: {} }); return { modified: true, etag };
  }
  async delete(name) { this.values.delete(name); }
}
const config = { appUrl: 'https://career.example', ownerEmail: 'owner@example.com', projectId: 'introduce-93ff8', firebaseWebApiKey: 'public-web-key', driveEnabled: false, aiEnabled: false };
const keys = await generateKeyPair('RS256');
const verifyJwt = async token => (await jwtVerify(token, keys.publicKey, { algorithms: ['RS256'] })).payload;
async function token(overrides = {}, key = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: config.ownerEmail, email_verified: true, auth_time: now, firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['google-sub'] } }, sub: 'owner-uid', aud: config.projectId, iss: `https://securetoken.google.com/${config.projectId}`, iat: now, exp: now + 3600, ...overrides }).setProtectedHeader({ alg: 'RS256' }).sign(key);
}
test('private Netlify vault shares one generated key and encrypts tokens with CAS single-use OAuth and persistent leases', async () => {
  const blobs = new MemoryBlobs(); const [one, two] = await Promise.all([createPrivateVault(blobs), createPrivateVault(blobs)]);
  await one.setJSON('tokens/owner', { refreshToken: 'private-refresh-value' });
  assert.equal((await two.getJSON('tokens/owner')).refreshToken, 'private-refresh-value');
  assert.ok(!JSON.stringify([...blobs.values]).includes('private-refresh-value'));
  await one.setJSON('oauth/state', { verifier: 'secret-verifier' });
  const consumed = await Promise.all([one.consumeJSON('oauth/state'), two.consumeJSON('oauth/state')]); assert.equal(consumed.filter(Boolean).length, 1);
  const release = await one.acquireLease('drive/owner'); await assert.rejects(two.acquireLease('drive/owner'), error => error.status === 409); await release();
  const releaseNext = await two.acquireLease('drive/owner'); await releaseNext();
  const raw = blobs.values.get('tokens/owner'); blobs.values.set('tokens/other', raw);
  await assert.rejects(two.getJSON('tokens/other'), error => error.status === 409, 'ciphertext cannot be rebound to a different vault entry');
});
test('expired leases can be replaced without an earlier release unlocking the new holder', async () => {
  const blobs = new MemoryBlobs(); const vault = await createPrivateVault(blobs);
  const oldRelease = await vault.acquireLease('backup', -1); const newRelease = await vault.acquireLease('backup'); await oldRelease();
  await assert.rejects(vault.acquireLease('backup'), error => error.status === 409); await newRelease();
});
test('Firebase public-key JWT verification permits only verified Google owner with the correct project and signature', async () => {
  const auth = createFreeAuth(config, { verifyJwt }); const owner = await token(); const identified = await auth.verifyToken(owner);
  assert.equal(identified.uid, 'owner-uid'); assert.equal(identified.firebase.identities['google.com'][0], 'google-sub');
  for (const overrides of [{ email: 'other@example.com' }, { email_verified: false }, { firebase: { sign_in_provider: 'password' } }]) await assert.rejects(auth.verifyToken(await token(overrides)), error => error.status === 403);
  for (const overrides of [{ aud: 'another-project' }, { iss: 'https://attacker.example' }, { auth_time: Date.now() / 1000 + 3600 }]) await assert.rejects(auth.verifyToken(await token(overrides)), error => error.status === 401);
  const otherKeys = await generateKeyPair('RS256'); await assert.rejects(auth.verifyToken(await token({}, otherKeys.privateKey)), error => error.status === 401);
  await assert.rejects(auth.identify(new Request(config.appUrl + '/api/status')), error => error.status === 401);
});
test('scheduled Firebase refresh verifies returned JWT owner and uid before retaining a renewed refresh token', async () => {
  const idToken = await token(); let result = { id_token: idToken, user_id: 'owner-uid', refresh_token: 'renewed-private-refresh-value' };
  const auth = createFreeAuth(config, { verifyJwt, fetcher: async (url, options) => { assert.ok(String(url).startsWith('https://securetoken.googleapis.com/')); assert.equal(options.body.get('grant_type'), 'refresh_token'); return Response.json(result); } });
  const refreshed = await auth.refreshFirebaseOwner('original-private-refresh-value', { uid: 'owner-uid' }); assert.equal(refreshed.refreshToken, result.refresh_token);
  await assert.rejects(auth.refreshFirebaseOwner('original-private-refresh-value', { uid: 'other-uid' }), error => error.status === 403);
  result = { id_token: await token({ email: 'other@example.com' }), user_id: 'other-uid' };
  await assert.rejects(auth.refreshFirebaseOwner('original-private-refresh-value', { uid: 'owner-uid' }), error => error.status === 403);
});
const encode = value => typeof value === 'string' ? { stringValue: value } : typeof value === 'number' ? { integerValue: String(value) } : typeof value === 'boolean' ? { booleanValue: value } : value === null ? { nullValue: null } : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } } : { mapValue: { fields: encodeFields(value) } };
const encodeFields = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, encode(value)]));
test('Firestore REST snapshot paginates and retries a revision change to avoid mixing concurrent edits', async () => {
  let rootReads = 0; const requests = [];
  const repo = new FreeRestRepository({ projectId: config.projectId, uid: 'owner-uid', idToken: 'private-id-token', fetcher: async (raw, options) => {
    const url = new URL(raw); requests.push(url); assert.equal(options.headers.Authorization, 'Bearer private-id-token');
    if (url.pathname.endsWith('/owner-uid')) { rootReads++; return Response.json({ fields: encodeFields({ activeVersion: 'version-one', revision: rootReads === 1 ? 0 : 1 }) }); }
    if (url.pathname.endsWith('/__workspace_pointer_v1')) return new Response(null, { status: 404 });
    if (url.pathname.endsWith('/careers')) return Response.json({ documents: [{ name: 'projects/test/documents/careerArchives/owner-uid/versions/version-one/careers/' + (url.searchParams.has('pageToken') ? 'second' : 'first'), fields: encodeFields({ title: '교육 활동', documentIds: [], verified: false }) }], ...(url.searchParams.has('pageToken') ? {} : { nextPageToken: 'next-page' }) });
    return Response.json({ documents: [] });
  } });
  const snapshot = await repo.snapshot(); assert.equal(snapshot.revision, 1); assert.equal(snapshot.careers.length, 2); assert.equal(rootReads, 4); assert.ok(requests.some(url => url.searchParams.get('pageToken') === 'next-page'));
  assert.deepEqual(decodeFields(encodeFields({ tags: ['AI'], nested: { a: true }, empty: null })), { tags: ['AI'], nested: { a: true }, empty: null });
});
test('free API status exposes no refresh tokens, denies other origins and falls back to rules without a paid AI call', async () => {
  const vault = await createPrivateVault(new MemoryBlobs()); const auth = createFreeAuth(config, { verifyJwt });
  const api = createFreeApi({ config, vault, auth, fetcher: async () => { throw new Error('no external call expected'); } }); const ownerToken = await token();
  const request = (path, body, headers = {}) => new Request(config.appUrl + path, { method: body ? 'POST' : 'GET', headers: { Origin: config.appUrl, Authorization: `Bearer ${ownerToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const anonymous = await api.handle(request('/api/status', undefined, { Authorization: '' })); const anonymousStatus = await anonymous.json(); assert.equal(anonymousStatus.user, null); assert.equal(anonymousStatus.driveConnected, false);
  const status = await (await api.handle(request('/api/status'))).json(); assert.equal(status.user.uid, 'owner-uid'); assert.equal(status.backend, 'netlify-free'); assert.equal(status.aiConfigured, false); assert.equal(status.user.token, undefined);
  assert.equal((await api.handle(request('/api/analyze', { text: '활동명: 디지털 교육 강의\n2025년 3월 14일' }, { Origin: 'https://attacker.example' }))).status, 403);
  const analysis = await (await api.handle(request('/api/analyze', { text: '활동명: 디지털 교육 강의\n2025년 3월 14일' }))).json(); assert.equal(analysis.method, 'rules'); assert.equal(analysis.careers[0].category, '강의·연수');
  assert.equal((await api.handle(request('/api/analyze', { text: '활동' }, { Authorization: '' }))).status, 401);
  assert.equal((await api.handle(request('/.netlify/functions/career-api/status'))).status, 200);
});
test('free readiness stays disabled for blank or malformed project and owner configuration', async () => {
  const vault = await createPrivateVault(new MemoryBlobs());
  for (const overrides of [{ projectId: '   ' }, { projectId: 'bad/project' }, { ownerEmail: '   ' }, { ownerEmail: 'missing-domain' }, { firebaseWebApiKey: '   ' }]) {
    const api = createFreeApi({ config: { ...config, ...overrides }, vault });
    const response = await api.handle(new Request(config.appUrl + '/api/status'));
    assert.equal((await response.json()).googleConfigured, false);
  }
});
test('free ZIP backup captures immutable Drive originals with the active snapshot and verifies each digest', async () => {
  const content = Buffer.from('공문 본문'); const document = { id: 'document-one', driveFileId: 'drive-document', name: '공문.txt', mime: 'text/plain', size: content.length, sha256: sha256(content), text: '공문 본문', analysisStatus: 'text-ready', createdAt: new Date().toISOString() };
  const career = normalizeCareer({ id: 'career-one', title: '교육 활동', documentIds: [document.id] }); let served = content;
  const drive = { requireFile: async (uid, id, options) => { assert.equal(options.driveAccessToken, 'already-held-token'); return { metadata: { name: document.name, size: content.length, mimeType: document.mime, appProperties: { archiveUid: uid, kind: 'document', sha256: document.sha256 } }, accessToken: 'already-held-token' }; } };
  const capture = createDriveBackup({ config, getDrive: () => drive, fetcher: async () => new Response(served), repositoryFactory: () => ({ snapshot: async () => ({ careers: [career], documents: [document], revision: 3, activeVersion: 'version-one' }) }) });
  const buffer = await capture('owner-uid', { idToken: 'id-token', driveAccessToken: 'already-held-token' }); const zip = await JSZip.loadAsync(buffer); const manifest = JSON.parse(await zip.file('manifest.json').async('string')); assert.equal(manifest.careers.length, 1); assert.equal(manifest.documents[0].sha256, document.sha256); assert.equal(await zip.file(manifest.documents[0].filePath).async('string'), content.toString());
  served = Buffer.from('변경된 공문'); await assert.rejects(capture('owner-uid', { idToken: 'id-token', driveAccessToken: 'already-held-token' }), error => error.status === 400);
});
test('automatic snapshots preserve links and immutable Drive references without original bytes or credentials', () => {
  const document = { id: 'document-one', driveFileId: 'drive-document', name: '공문.txt', mime: 'text/plain', size: 10, sha256: 'a'.repeat(64), text: '추출한 내용', analysisStatus: 'text-ready', createdAt: new Date().toISOString(), refreshToken: 'must-not-export' };
  const career = normalizeCareer({ id: 'career-one', title: '교육 활동', documentIds: [document.id] });
  const manifest = JSON.parse(serializeDriveSnapshot({ careers: [career], documents: [document] }));
  assert.equal(manifest.format, 'career-drive-snapshot'); assert.equal(manifest.documents[0].driveFileId, document.driveFileId); assert.deepEqual(manifest.careers[0].documentIds, [document.id]); assert.equal(manifest.documents[0].refreshToken, undefined);
  assert.throws(() => serializeDriveSnapshot({ careers: [career], documents: [] }), error => error.status === 400);
  assert.throws(() => serializeDriveSnapshot({ careers: [], documents: [{ ...document, sha256: 'invalid' }] }), error => error.status === 400);
  assert.throws(() => serializeDriveSnapshot({ careers: [{ ...career, startDate: '2026', endDate: '2025' }], documents: [document] }), error => error.status === 400);
  const legacyEmpty = JSON.parse(serializeDriveSnapshot({ careers: [], documents: [{ ...document, size: 0, text: '가'.repeat(40000) }] })); assert.equal(legacyEmpty.documents[0].size, 0); assert.equal(legacyEmpty.documents[0].text.length, 24000);
});
test('external request budget aborts before the platform deadline while leaving vault cleanup outside the budget', async () => {
  let calls = 0;
  const fetcher = budgetedFetch(async (url, options) => { calls++; return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); setTimeout(resolve, 100); }); });
  await assert.rejects(runWithDeadline(() => fetcher('https://example.com'), 10), error => error.name === 'TimeoutError');
  await assert.rejects(runWithDeadline(() => fetcher('https://example.com'), -1), error => error.status === 504); assert.equal(calls, 1);
});
