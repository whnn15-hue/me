import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/index.mjs';

async function start(dataDir, extra = {}) {
  const service = createApp({ dataDir, seedPath: null, localMode: true, appUrl: '', automaticBackups: false, aiKey: '', ...extra });
  const server = await new Promise(resolve => { const instance = service.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (body && !(body instanceof FormData) && !Buffer.isBuffer(body)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    return fetch(base + path, { ...options, headers, body });
  };
  return { ...service, request, requestBase: base, stop: async () => { await new Promise(resolve => server.close(resolve)); service.close(); } };
}
function upload(text = '활동명: 디지털 교육 특강\n기관: 한국교육학술정보원\n2025년 3월 14일 강사로 참여', name = '공문.txt', field = 'files') {
  const form = new FormData(); form.append(field, new Blob([text], { type: 'text/plain' }), name); return form;
}
async function json(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }

test('persistent careers, document deduplication, extraction, attachment lifecycle and ZIP restore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'career-backend-')); let service = await start(dir);
  try {
    assert.equal((await json(await service.request('/api/status'))).mode, 'local');
    const result = await json(await service.request('/api/documents', { method: 'POST', body: upload() }), 201);
    assert.equal(result.documents.length, 1); assert.equal(result.documents[0].name, '공문.txt');
    const document = result.documents[0];
    const duplicate = await json(await service.request('/api/documents', { method: 'POST', body: upload() }), 201);
    assert.deepEqual(duplicate.duplicates, ['공문.txt']); assert.equal(duplicate.documents[0].id, document.id);
    const analysis = await json(await service.request('/api/analyze', { method: 'POST', body: { documentId: document.id } }));
    assert.equal(analysis.method, 'rules'); assert.ok(analysis.warnings.length); assert.equal(analysis.careers[0].category, '강의·연수'); assert.equal(analysis.careers[0].startDate, '2025-03-14');
    const career = await json(await service.request('/api/careers', { method: 'POST', body: { ...analysis.careers[0], verified: true } }), 201);
    assert.deepEqual(career.documentIds, [document.id]); assert.equal(career.evidenceStatus, 'attached');
    assert.equal((await json(await service.request('/api/data'))).documents[0].recordIds[0], career.id);
    const standalone = await json(await service.request('/api/careers', { method: 'POST', body: { title: '증빙 없는 연구회 활동', category: '위원회·지원단', startDate: '2024', datePrecision: 'year' } }), 201);
    assert.equal(standalone.evidenceStatus, 'later');
    const backup = Buffer.from(await (await service.request('/api/backup/export')).arrayBuffer()); const archive = await JSZip.loadAsync(backup);
    assert.equal(JSON.parse(await archive.file('manifest.json').async('string')).careers.length, 2);
    const evidence = await service.request('/api/resume/evidence', { method: 'POST', body: { careerIds: [career.id] } }); assert.equal(evidence.status, 200);
    const evidenceZip = await JSZip.loadAsync(Buffer.from(await evidence.arrayBuffer()));
    const selected = JSON.parse(await evidenceZip.file('manifest.json').async('string')); assert.equal(selected.careers.length, 1); assert.equal(selected.documents.length, 1); assert.ok(evidenceZip.file('경력목록.csv'));
    await service.stop(); service = await start(dir);
    assert.equal((await json(await service.request('/api/data'))).careers.length, 2);
    const original = await service.request(`/api/documents/${document.id}/file`); assert.equal(original.status, 200); assert.ok((await original.text()).includes('디지털 교육'));
    await json(await service.request(`/api/documents/${document.id}`, { method: 'DELETE' }));
    const afterDelete = await json(await service.request('/api/data')); assert.equal(afterDelete.documents.length, 0); assert.deepEqual(afterDelete.careers.find(c => c.id === career.id).documentIds, []); assert.equal(afterDelete.careers.find(c => c.id === career.id).evidenceStatus, 'later');
    const restore = new FormData(); restore.append('file', new Blob([backup], { type: 'application/zip' }), 'backup.zip');
    const restored = await json(await service.request('/api/backup/restore', { method: 'POST', body: restore })); assert.equal(restored.documents, 1);
    assert.equal((await service.request(`/api/documents/${document.id}/file`)).status, 200);
    await json(await service.request(`/api/careers/${career.id}`, { method: 'DELETE' }));
    assert.deepEqual((await json(await service.request('/api/data'))).documents[0].recordIds, []);
  } finally { await service.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('reject hostile backups without replacing data, forged local hosts, cross-site mutations and invalid files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'career-security-')); const service = await start(dir);
  try {
    await json(await service.request('/api/careers', { method: 'POST', body: { title: '보존할 경력' } }), 201);
    const zip = new JSZip(); zip.file('../outside.txt', 'attack'); zip.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, careers: [], documents: [] }));
    const form = new FormData(); form.append('file', new Blob([await zip.generateAsync({ type: 'nodebuffer' })]), 'bad.zip');
    assert.equal((await service.request('/api/backup/restore', { method: 'POST', body: form })).status, 400);
    assert.equal((await json(await service.request('/api/data'))).careers.length, 1);
    const forged = await new Promise((resolve, reject) => { const req = httpRequest(service.requestBase + '/api/data', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(forged, 403);
    assert.equal((await service.request('/api/careers', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: { title: '주입' } })).status, 403);
    assert.equal((await service.request('/api/documents', { method: 'POST', body: upload('not-pdf', 'bad.pdf') })).status, 400);
    assert.equal((await service.request('/api/careers', { method: 'POST', body: { title: '잘못된 날짜', startDate: '2025-02-30' } })).status, 400);
    assert.equal((await service.request('/api/careers', { method: 'POST', body: { title: '잘못된 증빙', documentIds: ['missing'] } })).status, 400);
  } finally { await service.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('cloud mode fails closed and encrypted token storage survives restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'career-auth-')); let service = await start(dir, { localMode: false });
  try {
    assert.equal((await service.request('/api/data')).status, 503);
    assert.equal((await service.request('/api/documents/some/file')).status, 503);
    service.auth.saveTokens({ refresh_token: 'private-refresh-value', expiresAt: 0 });
    const raw = service.store.getSetting('driveTokens'); assert.ok(!raw.includes('private-refresh-value')); assert.equal(service.auth.tokens().refresh_token, 'private-refresh-value');
    const key = await readFile(join(dir, 'encryption.key')); assert.equal(key.length, 32);
    await service.stop(); service = await start(dir, { localMode: false });
    assert.equal(service.auth.tokens().refresh_token, 'private-refresh-value');
    const status = await json(await service.request('/api/status')); assert.equal(status.driveConnected, false); assert.equal(status.user, null);
  } finally { await service.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('real AI response is used when configured; failures are clearly labeled rule fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'career-ai-'));
  let calls = 0;
  const service = await start(dir, { aiKey: 'test-only', fetcher: async (url, options) => { calls++; assert.equal(url, 'https://api.openai.com/v1/chat/completions'); assert.equal(JSON.parse(options.body).response_format.type, 'json_object'); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ careers: [{ title: '연구회 회장', category: '위원회·지원단', startDate: '2024', tags: ['연구회'] }], warnings: [] }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } });
  try { const result = await json(await service.request('/api/analyze', { method: 'POST', body: { text: '2024년 연구회 회장' } })); assert.equal(result.method, 'ai'); assert.equal(result.careers[0].title, '연구회 회장'); assert.equal(result.careers[0].verified, false); assert.equal(calls, 1); service.config.fetcher = async () => { throw new Error('simulated upstream outage'); }; const fallback = await json(await service.request('/api/analyze', { method: 'POST', body: { text: '2024년 연구회 회장' } })); assert.equal(fallback.method, 'rules'); assert.ok(fallback.warnings.some(w => w.includes('실패'))); }
  finally { await service.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('HWPX API inspects and fills cells, preserves other archive entries and reports invalid template errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'career-template-')); const service = await start(dir);
  try {
    const zip = new JSZip(); zip.file('mimetype', 'application/hwp+zip'); zip.file('Contents/header.xml', '<header keep="yes"/>');
    zip.file('Contents/section0.xml', '<?xml version="1.0"?><hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp"><hp:tbl><hp:tr><hp:tc><hp:p><hp:run><hp:t>이름</hp:t></hp:run></hp:p></hp:tc><hp:tc><hp:p><hp:run><hp:t/></hp:run></hp:p></hp:tc></hp:tr></hp:tbl></hs:sec>');
    const template = await zip.generateAsync({ type: 'nodebuffer' });
    const form = new FormData(); form.append('file', new Blob([template]), '양식.hwpx');
    const inspection = await json(await service.request('/api/resume/hwpx/inspect', { method: 'POST', body: form })); assert.equal(inspection.fields.length, 2);
    const fill = new FormData(); fill.append('file', new Blob([template]), '양식.hwpx'); fill.append('mappings', JSON.stringify({ [inspection.fields[1].id]: '나의 경력 & 연구' }));
    const response = await service.request('/api/resume/hwpx/fill', { method: 'POST', body: fill }); assert.equal(response.status, 200);
    const filled = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer())); assert.equal(await filled.file('Contents/header.xml').async('string'), '<header keep="yes"/>'); assert.ok((await filled.file('Contents/section0.xml').async('string')).includes('나의 경력 &amp; 연구'));
    const invalid = new FormData(); invalid.append('file', new Blob(['not-a-zip']), 'invalid.hwpx'); assert.equal((await service.request('/api/resume/hwpx/inspect', { method: 'POST', body: invalid })).status, 400);
  } finally { await service.stop(); await rm(dir, { recursive: true, force: true }); }
});

test('local mode shows a real authenticated owner session and never another account', async () => {
  const { createHash } = await import('node:crypto');
  const dir = await mkdtemp(join(tmpdir(), 'career-local-session-')); const service = await start(dir, { ownerEmail: 'owner@example.com' });
  try {
    const token = 'test-valid-session'; const sessionId = createHash('sha256').update(token).digest('hex');
    service.store.putSession(sessionId, { name: '본인', email: 'owner@example.com' }, Date.now() + 60000);
    const response = await json(await service.request('/api/status', { headers: { cookie: `career_session=${token}` } }));
    assert.equal(response.mode, 'local'); assert.equal(response.user.email, 'owner@example.com');
    service.store.putSession(sessionId, { name: '다른 계정', email: 'other@example.com' }, Date.now() + 60000);
    assert.equal((await json(await service.request('/api/status', { headers: { cookie: `career_session=${token}` } }))).user, null);
  } finally { await service.stop(); await rm(dir, { recursive: true, force: true }); }
});
