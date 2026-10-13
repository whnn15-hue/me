import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudApp } from '../server/cloud/app.mjs';
import { CloudStore } from '../server/cloud/store.mjs';
import { captureBackup } from '../server/cloud/files.mjs';
import JSZip from 'jszip';

// The adapter models atomic commits and consistent query reads. No Google
// credential is needed to validate the private API and restore protocol.
class MemoryFirestore {
  constructor() { this.values = new Map(); this.tail = Promise.resolve(); }
  collection(path) { return new Collection(this, path); }
  async runTransaction(action) {
    const before = this.tail; let release; this.tail = new Promise(resolve => { release = resolve; }); await before;
    const view = new Map([...this.values].map(([path, value]) => [path, structuredClone(value)]));
    const tx = { get: async ref => ref.read(view), set: (ref, value) => view.set(ref.path, structuredClone(value)), update: (ref, value) => { if (!view.has(ref.path)) throw new Error('missing update'); view.set(ref.path, { ...view.get(ref.path), ...structuredClone(value) }); }, delete: ref => view.delete(ref.path) };
    try { const result = await action(tx); this.values = view; return result; } finally { release(); }
  }
  batch() { const writes = []; return { set: (ref, value) => writes.push([ref, value]), commit: async () => { for (const [ref, value] of writes) this.values.set(ref.path, structuredClone(value)); } }; }
}
class Collection {
  constructor(db, path, filter) { this.db = db; this.path = path; this.filter = filter; }
  doc(id) { return new Reference(this.db, `${this.path}/${id}`); }
  where(field, operator, value) { return new Collection(this.db, this.path, [field, value]); }
  read(view = this.db.values) { const prefix = this.path + '/'; const docs = [...view.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).map(path => new Reference(this.db, path).read(view)).filter(doc => !this.filter || doc.data()[this.filter[0]] === this.filter[1]); return { docs }; }
  async get() { return this.read(); }
}
class Reference {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
  read(view = this.db.values) { const value = view.get(this.path); return { exists: view.has(this.path), id: this.id, data: () => structuredClone(value) }; }
  async get() { return this.read(); }
  async set(value) { this.db.values.set(this.path, structuredClone(value)); }
  async create(value) { if (this.db.values.has(this.path)) throw new Error('already exists'); return this.set(value); }
  async update(value) { return this.set({ ...this.db.values.get(this.path), ...value }); }
  async delete() { this.db.values.delete(this.path); }
}
class MemoryBucket {
  constructor() { this.objects = new Map(); this.signed = []; this.nextGeneration = 1; }
  file(path, options) {
    const bucket = this;
    return {
      save: async (buffer, settings = {}) => { if (settings.preconditionOpts?.ifGenerationMatch === 0 && bucket.objects.has(path)) throw new Error('exists'); bucket.objects.set(path, { buffer: Buffer.from(buffer), generation: String(bucket.nextGeneration++), settings }); },
      download: async () => { const object = bucket.objects.get(path); if (!object || options?.generation && options.generation !== object.generation) throw Object.assign(new Error('not found'), { code: 404 }); return [Buffer.from(object.buffer)]; },
      getMetadata: async () => { const object = bucket.objects.get(path); if (!object) throw Object.assign(new Error('not found'), { code: 404 }); return [{ size: String(object.buffer.length), generation: object.generation }]; },
      getSignedUrl: async settings => { bucket.signed.push({ path, settings }); return [`https://storage.example/${encodeURIComponent(path)}?signed=true`]; },
      delete: async () => bucket.objects.delete(path),
    };
  }
}
const CONFIG = { appUrl: 'https://career.example', ownerEmail: 'owner@example.com', projectId: 'career-test', storageBucket: 'career-test.firebasestorage.app', aiEnabled: false, driveEnabled: false };
async function start(extra = {}) {
  const db = new MemoryFirestore(), bucket = new MemoryBucket();
  const auth = { verifyIdToken: async token => {
    if (token === 'bad') throw new Error('invalid');
    return { uid: token === 'other' ? 'other-uid' : 'owner-uid', email: token === 'other' ? 'other@example.com' : 'owner@example.com', email_verified: token !== 'unverified', firebase: { sign_in_provider: token === 'password' ? 'password' : 'google.com' }, name: 'Owner' };
  } };
  const config = { ...CONFIG, ...extra }; const storeFactory = (uid, email) => new CloudStore(db, uid, email);
  const service = createCloudApp({ db, bucket, auth, config, storeFactory });
  const server = await new Promise(resolve => { const instance = service.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = async (path, options = {}) => {
    const headers = { Origin: CONFIG.appUrl, Authorization: 'Bearer owner', ...options.headers }; let body = options.body;
    if (body && !(body instanceof FormData) && !Buffer.isBuffer(body)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { ...options, headers, body });
  };
  return { ...service, db, bucket, request, repo: storeFactory('owner-uid', CONFIG.ownerEmail), stop: () => new Promise(resolve => server.close(resolve)) };
}
async function json(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
function upload(text = '활동명: 미디어 교육 강의\n기관: 교육청\n2025년 3월 14일', name = '공문.txt') { const form = new FormData(); form.append('files', new Blob([text]), name); return form; }

test('Firebase owner access denies absent, invalid, other, unverified and non-Google identities; CORS denies other sites', async () => {
  const service = await start();
  try {
    for (const token of ['', 'bad', 'other', 'unverified', 'password']) assert.equal((await service.request('/data', { headers: { Authorization: token ? `Bearer ${token}` : '' } })).status, ['', 'bad'].includes(token) ? 401 : 403);
    assert.equal((await service.request('/data', { headers: { Origin: 'https://attacker.example' } })).status, 403);
    const anonymous = await json(await service.request('/status', { headers: { Authorization: '' } })); assert.equal(anonymous.user, null); assert.equal(anonymous.lastBackup, null); assert.equal(anonymous.driveConnected, false);
    assert.equal(service.db.values.size, 0, 'failed access must not create a seeded archive');
    const status = await json(await service.request('/status')); assert.equal(status.mode, 'firebase'); assert.equal(status.user.email, CONFIG.ownerEmail); assert.equal(status.driveConfigured, false);
    assert.equal((await json(await service.request('/data'))).careers.length, 0, 'deployed archive starts empty without embedding personal seed records');
    assert.equal((await service.request('/data')).headers.get('access-control-allow-origin'), CONFIG.appUrl);
  } finally { await service.stop(); }
  const disabled = await start({ ownerEmail: '' }); try { assert.equal((await disabled.request('/data')).status, 503); assert.equal((await json(await disabled.request('/status', { headers: { Authorization: '' } }))).googleConfigured, false); } finally { await disabled.stop(); }
});

test('explicit private initialization runs once and preserves existing careers on restart', async () => {
  const db = new MemoryFirestore();
  const first = new CloudStore(db, 'owner-uid', CONFIG.ownerEmail, [{ id: 'private-seed', title: '직접 가져온 경력' }]);
  await first.ensureInitialized();
  await first.mutate(state => { state.careers.set('private-seed', { ...state.careers.get('private-seed'), title: '본인이 수정한 경력', verified: true }); });
  const second = new CloudStore(db, 'owner-uid', CONFIG.ownerEmail, [{ id: 'private-seed', title: '새 초기값' }, { id: 'new-seed', title: '추가 초기값' }]);
  await second.ensureInitialized(); const snapshot = await second.snapshot();
  assert.equal(snapshot.careers.length, 1); assert.equal(snapshot.careers[0].title, '본인이 수정한 경력'); assert.equal(snapshot.careers[0].verified, true);
});

test('durable transactional documents deduplicate, link and delete metadata while keeping export snapshots valid', async () => {
  const service = await start();
  try {
    const document = (await json(await service.request('/documents', { method: 'POST', body: upload() }), 201)).documents[0]; assert.equal(document.name, '공문.txt'); assert.equal(document.analysisStatus, 'text-ready'); assert.equal(document.storageName, undefined);
    const duplicate = await json(await service.request('/documents', { method: 'POST', body: upload() }), 201); assert.equal(duplicate.documents[0].id, document.id); assert.deepEqual(duplicate.duplicates, ['공문.txt']);
    const career = await json(await service.request('/careers', { method: 'POST', body: { title: '교육청 강의', documentIds: [document.id] } }), 201);
    const analysis = await json(await service.request('/analyze', { method: 'POST', body: { documentId: document.id } })); assert.equal(analysis.careers[0].category, '강의·연수');
    const download = await json(await service.request(`/documents/${document.id}/file`)); assert.equal(download.fileName, '공문.txt'); assert.ok(download.downloadUrl.startsWith('https://storage.example/'));
    const snapshot = await service.repo.snapshot(); const backup = await captureBackup(service.repo, service.bucket, [career.id]);
    await json(await service.request(`/documents/${document.id}`, { method: 'DELETE' }));
    const data = await json(await service.request('/data')); assert.equal(data.documents.length, 0); assert.deepEqual(data.careers.find(value => value.id === career.id).documentIds, []);
    assert.ok(service.bucket.objects.size > 0, 'deleted originals remain available for captured metadata snapshots');
    const captured = { ...service.repo, uid: service.repo.uid, snapshot: async () => snapshot }; const afterDelete = await captureBackup(captured, service.bucket, [career.id]);
    assert.equal(JSON.parse(await (await JSZip.loadAsync(afterDelete)).file('manifest.json').async('string')).documents.length, 1);
    assert.ok(backup.length > 0);
    const restart = new CloudStore(service.db, 'owner-uid', CONFIG.ownerEmail); assert.equal((await restart.snapshot()).documents.length, 0);
  } finally { await service.stop(); }
});

test('signed ZIP export and staged restore retain data on invalid archives and concurrent revisions', async () => {
  const service = await start();
  try {
    const career = await json(await service.request('/careers', { method: 'POST', body: { title: '보존할 경력' } }), 201);
    const exported = await json(await service.request('/backup/export')); assert.ok(exported.downloadUrl); assert.ok(exported.fileName.endsWith('.zip'));
    const backupObject = [...service.bucket.objects.entries()].find(([path]) => path.includes('/exports/'))[1].buffer;
    const requested = await json(await service.request('/backup/upload-url', { method: 'POST', body: { name: 'backup.zip', size: backupObject.length } }));
    const upload = (await service.repo.upload(requested.uploadId).get()).data(); assert.equal(upload.ownerUid, 'owner-uid');
    await service.bucket.file(upload.storagePath).save(backupObject);
    await json(await service.request(`/careers/${career.id}`, { method: 'PUT', body: { title: '복원으로 교체할 수정' } }));
    const restored = await json(await service.request('/backup/restore', { method: 'POST', body: { uploadId: requested.uploadId } })); assert.equal(restored.ok, true);
    assert.equal((await service.repo.snapshot()).careers.find(value => value.id === career.id).title, '보존할 경력');
    const expected = await service.repo.snapshot();
    await service.repo.mutate(state => { state.careers.set(career.id, { ...state.careers.get(career.id), title: '동시 수정 보존' }); });
    await assert.rejects(service.repo.stageAndActivate(expected, expected), error => error.status === 409);
    assert.equal((await service.repo.snapshot()).careers.find(value => value.id === career.id).title, '동시 수정 보존');
    const invalid = Buffer.from('invalid archive'); const bad = await json(await service.request('/backup/upload-url', { method: 'POST', body: { name: 'backup.zip', size: invalid.length } })); const badUpload = (await service.repo.upload(bad.uploadId).get()).data(); await service.bucket.file(badUpload.storagePath).save(invalid);
    assert.equal((await service.request('/backup/restore', { method: 'POST', body: { uploadId: bad.uploadId } })).status, 400);
    assert.equal((await service.repo.snapshot()).careers.find(value => value.id === career.id).title, '동시 수정 보존');
    assert.equal((await service.request('/backup/restore', { method: 'POST', body: { uploadId: '../other' } })).status, 404);
    assert.equal((await service.request('/backup/upload-url', { method: 'POST', body: { name: 'backup.zip', size: 201 * 1024 * 1024 } })).status, 400);
  } finally { await service.stop(); }
});

test('Cloud Functions pre-consumed multipart rawBody supports extraction and enforces one-file protocol', async () => {
  const service = await start();
  try {
    // The dedicated parser is also exercised with the rawBody path on a second
    // wrapper, matching the Functions Framework request lifecycle.
    const { multipart } = await import('../server/cloud/files.mjs'); const { default: express } = await import('express'); const wrapper = express();
    wrapper.use(express.raw({ type: 'multipart/form-data', limit: '32mb' })); wrapper.use((req, res, next) => { req.rawBody = req.body; next(); });
    wrapper.post('/', multipart('files'), (req, res) => res.json({ name: req.file.originalname, text: req.file.buffer.toString() }));
    wrapper.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
    const server = await new Promise(resolve => { const instance = wrapper.listen(0, '127.0.0.1', () => resolve(instance)); });
    try { const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: upload('한국어 본문', '한글 공문.txt') }); const result = await json(response); assert.equal(result.name, '한글 공문.txt'); assert.equal(result.text, '한국어 본문'); }
    finally { await new Promise(resolve => server.close(resolve)); }
    const form = upload(); form.append('files', new Blob(['second']), 'second.txt'); assert.equal((await service.request('/documents', { method: 'POST', body: form })).status, 413);
  } finally { await service.stop(); }
});
