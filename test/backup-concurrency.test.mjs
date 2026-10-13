import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises, { mkdtemp, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { createApp } from '../server/index.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'career-concurrency-'));
  const service = createApp({ dataDir: directory, seedPath: null, localMode: true, appUrl: '', automaticBackups: false, aiKey: '' });
  const server = await new Promise(resolve => { const instance = service.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { body, headers = {}, ...options } = {}) => {
    if (body && !(body instanceof FormData)) { body = JSON.stringify(body); headers = { ...headers, 'Content-Type': 'application/json' }; }
    return fetch(base + path, { ...options, headers, body });
  };
  const upload = new FormData(); upload.append('files', new Blob(['원본 공문 내용']), '공문.txt');
  const uploaded = await request('/api/documents', { method: 'POST', body: upload });
  assert.equal(uploaded.status, 201);
  const document = (await uploaded.json()).documents[0];
  const saved = await request('/api/careers', { method: 'POST', body: { title: '기존 경력', documentIds: [document.id] } });
  assert.equal(saved.status, 201);
  const career = await saved.json();
  const output = await request('/api/backup/export'); assert.equal(output.status, 200);
  const backup = Buffer.from(await output.arrayBuffer());
  return { ...service, server, request, backup, document, career, stop: async () => { await new Promise(resolve => server.close(resolve)); service.close(); await rm(directory, { recursive: true, force: true }); } };
}

function pauseOriginalIo(service, method, failure = null) {
  const original = fsPromises[method];
  let enteredResolve, resumeResolve, intercepted = false;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const barrier = new Promise(resolve => { resumeResolve = resolve; });
  fsPromises[method] = async (path, ...args) => {
    if (!intercepted && typeof path === 'string' && path.startsWith(join(service.store.dataDir, 'originals') + '/')) {
      intercepted = true; enteredResolve(); await barrier;
      if (failure) throw failure;
    }
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  return { entered, resume: () => resumeResolve(), restore: () => { resumeResolve(); fsPromises[method] = original; syncBuiltinESMExports(); } };
}

function observeQueuedRequest(server) {
  return new Promise(resolve => {
    const observe = req => {
      if (req.headers['x-queue-test'] !== 'yes') return;
      server.off('request', observe);
      req.once('end', resolve);
      // DELETE has no body parser to consume its empty request stream.
      req.resume();
    };
    server.on('request', observe);
  });
}

const turn = () => new Promise(resolve => setImmediate(resolve));
const restoring = (service) => { const form = new FormData(); form.append('file', new Blob([service.backup]), 'backup.zip'); return service.request('/api/backup/restore', { method: 'POST', body: form }); };

test('a career added during restore staging waits and survives the restore commit', async () => {
  const service = await fixture();
  const pause = pauseOriginalIo(service, 'writeFile');
  let restoreResponse, editResponse;
  try {
    restoreResponse = restoring(service);
    await pause.entered;
    const read = await service.request('/api/data');
    assert.equal(read.status, 200);
    assert.equal((await read.json()).careers[0].title, '기존 경력');
    const received = observeQueuedRequest(service.server);
    editResponse = service.request('/api/careers', { method: 'POST', headers: { 'x-queue-test': 'yes' }, body: { title: '복원 중 추가한 경력' } });
    await received; await turn();
    assert.equal(service.store.careers().length, 1);
    pause.resume();
    assert.equal((await restoreResponse).status, 200);
    assert.equal((await editResponse).status, 201);
    assert.deepEqual(service.store.careers().map(career => career.title).sort(), ['기존 경력', '복원 중 추가한 경력'].sort());
    assert.ok(service.store.document(service.document.id));
  } finally { pause.restore(); await Promise.allSettled([restoreResponse, editResponse].filter(Boolean)); await service.stop(); }
});

test('deleting an original during export waits until the immutable ZIP snapshot is captured', async () => {
  const service = await fixture();
  const pause = pauseOriginalIo(service, 'readFile');
  let exporting, deleting;
  try {
    exporting = service.request('/api/backup/export');
    await pause.entered;
    const received = observeQueuedRequest(service.server);
    deleting = service.request(`/api/documents/${service.document.id}`, { method: 'DELETE', headers: { 'x-queue-test': 'yes' } });
    await received; await turn();
    assert.ok(service.store.document(service.document.id));
    pause.resume();
    const response = await exporting; assert.equal(response.status, 200);
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.equal(manifest.documents.length, 1);
    assert.equal(await zip.file(manifest.documents[0].filePath).async('string'), '원본 공문 내용');
    assert.equal((await deleting).status, 200);
    assert.equal(service.store.document(service.document.id), null);
    assert.deepEqual(service.store.career(service.career.id).documentIds, []);
  } finally { pause.restore(); await Promise.allSettled([exporting, deleting].filter(Boolean)); await service.stop(); }
});

test('an async restore failure releases the queue and preserves the previous archive', async () => {
  const service = await fixture();
  const pause = pauseOriginalIo(service, 'writeFile', new Error('simulated filesystem failure'));
  let restoreResponse, editResponse;
  try {
    restoreResponse = restoring(service);
    await pause.entered;
    const received = observeQueuedRequest(service.server);
    editResponse = service.request('/api/careers', { method: 'POST', headers: { 'x-queue-test': 'yes' }, body: { title: '실패 후 추가한 경력' } });
    await received; await turn();
    assert.equal(service.store.careers().length, 1);
    pause.resume();
    assert.equal((await restoreResponse).status, 500);
    assert.equal((await editResponse).status, 201);
    assert.ok(service.store.document(service.document.id));
    assert.equal(service.store.careers().length, 2);
    const original = await service.request(`/api/documents/${service.document.id}/file`);
    assert.equal(original.status, 200);
    assert.equal(await original.text(), '원본 공문 내용');
  } finally { pause.restore(); await Promise.allSettled([restoreResponse, editResponse].filter(Boolean)); await service.stop(); }
});
