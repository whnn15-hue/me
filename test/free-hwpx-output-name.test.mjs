import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createFreeApi } from '../server/free/api.mjs';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const FOLDER = 'ABCDEF0123456789!100', TEMPLATE = 'ABCDEF0123456789!101', OUTPUT = 'ABCDEF0123456789!200';
const storedName = '지원서__e9144ab2-674f-41fe-8cb9-812b6cc51fa1.hwpx';
const owner = { uid: 'owner-uid', email: 'owner@example.com', token: 'fixture-firebase-token' };
const config = { appUrl: 'https://career.example', projectId: 'test-career', ownerEmail: owner.email, firebaseWebApiKey: 'public-test-key',
  storageProvider: 'onedrive', microsoftClientId: 'fixture-client', microsoftClientSecret: 'fixture-secret' };
const zip = new JSZip();
zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
zip.file('Contents/header.xml', '<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"/>');
zip.file('Contents/content.hpf', '<package><metadata/></package>');
zip.file('Contents/section0.xml', '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p><hp:run><hp:t>지원서 양식</hp:t></hp:run></hp:p></hs:sec>');
const templateBytes = await zip.generateAsync({ type: 'nodebuffer' });
const sha256 = createHash('sha256').update(templateBytes).digest('hex');

function fixture(overrides = {}) {
  const values = new Map([
    ['configuredOwner', { uid: owner.uid, email: owner.email }],
    [`oneDriveTokens/${owner.uid}`, { access_token: 'fixture-graph-token', refresh_token: 'fixture-refresh', expiresAt: Date.now() + 3600000 }],
  ]);
  const vault = { getJSON: async key => values.get(key) || null, setJSON: async (key, value) => values.set(key, value),
    deleteJSON: async key => values.delete(key), acquireLease: async () => async () => {} };
  const calls = [], uploads = [];
  const metadata = { id: TEMPLATE, name: storedName, size: templateBytes.length, parentReference: { id: FOLDER }, file: { mimeType: 'application/vnd.hancom.hwpx' },
    description: JSON.stringify({ v: 1, archiveUid: owner.uid, kind: 'template', sha256 }), ...overrides };
  const api = createFreeApi({ config, vault, auth: { identify: async () => owner }, logger: () => {}, fetcher: async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    assert.equal(options.headers.Authorization, 'Bearer fixture-graph-token');
    if (url.includes('/special/approot')) return Response.json({ id: FOLDER });
    if (url.startsWith(`${GRAPH}/me/drive/items/${encodeURIComponent(TEMPLATE)}?`)) return Response.json(metadata);
    if (url === `${GRAPH}/me/drive/items/${encodeURIComponent(TEMPLATE)}/content`) return new Response(templateBytes, { headers: { 'Content-Length': String(templateBytes.length) } });
    if (options.method === 'PUT' && url.includes(':/content?')) {
      uploads.push(Buffer.from(options.body));
      return Response.json({ id: OUTPUT, name: decodeURIComponent(new URL(url).pathname.split(':/').at(-2)) }, { status: 201 });
    }
    if (url === `${GRAPH}/me/drive/items/${encodeURIComponent(OUTPUT)}` && options.method === 'PATCH') return Response.json({ id: OUTPUT });
    assert.fail(`Unexpected request: ${options.method || 'GET'} ${url}`);
  } });
  const fill = name => api.handle(new Request(`${config.appUrl}/api/resume/hwpx/fill`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-owner' },
    body: JSON.stringify({ templateFileId: TEMPLATE, name, mappings: {} }),
  }));
  return { fill, calls, uploads };
}

test('owned UUID storage template uses the original client title for its HWPX download', async () => {
  const f = fixture(); const response = await f.fill('지원서.hwpx');
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.fileName, '작성-지원서.hwpx'); assert.equal(result.driveFileId, OUTPUT);
  assert.deepEqual(f.uploads, [templateBytes]);
  assert.ok(f.calls.some(call => call.url.includes(encodeURIComponent(TEMPLATE))));
});

test('invalid or missing display hints fall back to the real template filename', async () => {
  for (const hint of [undefined, null, '', '   ', 42, {}, [], '지원서.pdf', '.hwpx', 'a'.repeat(301) + '.hwpx']) {
    const f = fixture(); const response = await f.fill(hint);
    assert.equal(response.status, 200, `hint: ${JSON.stringify(hint)}`);
    assert.equal((await response.json()).fileName, `작성-${storedName}`);
    assert.equal(f.uploads.length, 1);
  }
});

test('display hints are sanitized and cannot change the stored template type check', async () => {
  const valid = fixture(); const sanitized = await valid.fill('  원본/지원서.hwpx  ');
  assert.equal(sanitized.status, 200); assert.equal((await sanitized.json()).fileName, '작성-원본_지원서.hwpx');
  const invalid = fixture({ name: 'actual-file.pdf' }); const blocked = await invalid.fill('지원서.hwpx');
  assert.equal(blocked.status, 400); assert.match((await blocked.json()).error, /HWPX 양식/);
  assert.equal(invalid.uploads.length, 0);
});

test('a filename hint cannot bypass template ownership, folder, kind or hash checks', async () => {
  for (const override of [
    { description: JSON.stringify({ v: 1, archiveUid: 'other-owner', kind: 'template', sha256 }) },
    { parentReference: { id: 'ABCDEF0123456789!999' } },
    { description: JSON.stringify({ v: 1, archiveUid: owner.uid, kind: 'document', sha256 }) },
    { description: JSON.stringify({ v: 1, archiveUid: owner.uid, kind: 'template', sha256: 'a'.repeat(64) }) },
  ]) {
    const f = fixture(override); const response = await f.fill('지원서.hwpx');
    assert.ok([400, 403].includes(response.status)); assert.equal(f.uploads.length, 0);
  }
});
