import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createApp } from '../server/index.mjs';
import { validateFile } from '../server/cloud/files.mjs';
import { exportBackup, restoreBackup } from '../server/backup.mjs';
import { serializeDriveSnapshot } from '../server/free/snapshot.mjs';

const root = new URL('..', import.meta.url).pathname;
async function browserModule(entryPoint, plugins = []) {
  const output = await build({ entryPoints: [entryPoint], absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', write: false, plugins });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
}
const drive = await browserModule('src/free/drive.ts', [{ name: 'no-cloud-access', setup(builder) {
  builder.onResolve({ filter: /^\.\.\/(api|cloud)$/ }, () => ({ path: 'runtime', namespace: 'offline-cell-test' }));
  builder.onLoad({ filter: /.*/, namespace: 'offline-cell-test' }, () => ({ contents: 'export function api(){throw new Error("Unexpected network request")} export function readyCloudUser(){throw new Error("Unexpected sign-in")} export function cloudUserError(){return ""}', loader: 'js' }));
} }]);
const { createBackupBlob, readBackupFile, readDriveSnapshotFile } = await browserModule('src/free/backup.ts');
const { normalizeDocumentRecord } = await browserModule('src/free/normalize.ts');
const sample = new JSZip();
sample.file('[Content_Types].xml', '<Types/>');
sample.file('xl/workbook.xml', '<workbook/>');
sample.file('xl/worksheets/sheet1.xml', '<worksheet/>');
const bytes = await sample.generateAsync({ type: 'uint8array' });
const mime = 'application/vnd.hancom.cell';
const name = '가상 강좌 일정.cell';
const digest = createHash('sha256').update(bytes).digest('hex');
const document = { id: 'cell_original', name, mime, size: bytes.length, sha256: digest, recordIds: [], createdAt: '2026-01-01T00:00:00.000Z', bytes, text: '', analysisStatus: 'extraction-unavailable' };

test('CELL original validates consistently for browser Drive and server upload, but cannot be used as an HWPX template', async () => {
  assert.equal(await drive.validateDriveUploadFile(new File([bytes], name)), mime);
  assert.equal(validateFile({ originalname: name, buffer: Buffer.from(bytes) }).mime, mime);
  assert.equal(normalizeDocumentRecord(document).name, name);
  assert.equal(await drive.validateDriveUploadFile(new File([bytes], 'upper.CELL')), mime);
  await assert.rejects(drive.validateDriveUploadFile(new File(['not a spreadsheet'], name)), /실제 내용/);
  assert.throws(() => validateFile({ originalname: name, buffer: Buffer.from('not a spreadsheet') }), /일치하지/);
  await assert.rejects(drive.validateDriveUploadFile(new File([bytes], name), 'template'), /HWPX 양식/);
});

test('CELL bytes survive browser ZIP and scheduled Drive metadata backup round-trips', async () => {
  const blob = await createBackupBlob({ careers: [], documents: [document] });
  const restored = await readBackupFile(new File([blob], 'backup.zip'));
  assert.equal(restored.documents[0].name, name);
  assert.equal(restored.documents[0].mime, mime);
  assert.deepEqual(restored.documents[0].bytes, bytes);
  assert.equal(restored.documents[0].sha256, digest);
  const snapshot = serializeDriveSnapshot({ careers: [], documents: [{ ...document, bytes: undefined, driveFileId: 'owned_cell_original' }] });
  const parsed = await readDriveSnapshotFile(new File([snapshot], 'snapshot.json'));
  assert.equal(parsed.documents[0].name, name);
  assert.equal(parsed.documents[0].driveFileId, 'owned_cell_original');
});

test('local CELL upload preserves the original through server backup and restore', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'career-cell-original-'));
  const service = createApp({ dataDir, seedPath: null, localMode: true, appUrl: '', automaticBackups: false, aiKey: '' });
  const server = await new Promise(resolve => { const instance = service.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const upload = new FormData(); upload.append('files', new File([bytes], name));
    const response = await fetch(`${base}/api/documents`, { method: 'POST', body: upload });
    assert.equal(response.status, 201);
    const uploaded = (await response.json()).documents[0];
    assert.equal(uploaded.name, name); assert.equal(uploaded.mime, mime);
    const backup = await exportBackup(service.store);
    const browserRead = await readBackupFile(new File([backup], 'backup.zip'));
    assert.deepEqual(browserRead.documents[0].bytes, bytes);
    assert.deepEqual(await restoreBackup(service.store, backup), { ok: true, careers: 0, documents: 1 });
    const downloaded = await fetch(`${base}/api/documents/${uploaded.id}/file`);
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
    const invalid = new FormData(); invalid.append('files', new File(['bad'], name));
    assert.equal((await fetch(`${base}/api/documents`, { method: 'POST', body: invalid })).status, 400);
    assert.equal(service.store.documents().length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve)); service.close(); await rm(dataDir, { recursive: true, force: true });
  }
});
