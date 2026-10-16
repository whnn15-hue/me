import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, normalizeCareer } from '../server/store.mjs';
import { exportBackup, restoreBackup } from '../server/backup.mjs';

// Bundle as a browser module: an accidental Node-only import fails here too.
const output = await build({ entryPoints: ['src/free/backup.ts'], absWorkingDir: new URL('..', import.meta.url).pathname, bundle: true, platform: 'browser', format: 'esm', write: false });
const { createBackupBlob, readBackupFile, readDriveSnapshotFile } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
const file = bytes => new File([bytes], 'backup.zip', { type: 'application/zip' });
const bytes = new TextEncoder().encode('공문 원본 내용');
const hash = createHash('sha256').update(bytes).digest('hex');
const career = normalizeCareer({ id: 'career_one', title: '위원회 활동', documentIds: ['doc_one'] });
const document = { id: 'doc_one', name: '공문.txt', mime: 'text/plain', size: bytes.length, recordIds: ['career_one'], createdAt: '2026-01-01T00:00:00.000Z', bytes, sha256: hash };

async function withStore(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'career-browser-backup-'));
  const store = new Store(directory, null);
  try { await fn(store); } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}
async function zipFor(manifest, extra = {}) {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('originals/doc_one.txt', bytes);
  for (const [path, content] of Object.entries(extra)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
const manifest = () => ({ format: 'career-archive', version: 1, careers: [career], documents: [{ ...document, bytes: undefined, filePath: 'originals/doc_one.txt' }] });

test('browser backups round-trip and restore with the existing local backend', async () => {
  const blob = await createBackupBlob({ careers: [career], documents: [document] });
  const backupBytes = new Uint8Array(await blob.arrayBuffer());
  const restored = await readBackupFile(file(backupBytes));
  assert.deepEqual(restored.careers, [career]);
  assert.equal(restored.documents[0].sha256, hash);
  assert.deepEqual(restored.documents[0].bytes, bytes);
  assert.deepEqual(restored.documents[0].recordIds, ['career_one']);
  await withStore(async store => {
    assert.deepEqual(await restoreBackup(store, Buffer.from(backupBytes)), { ok: true, careers: 1, documents: 1 });
    assert.equal(store.career('career_one').title, career.title);
  });
});

test('browser restore accepts local exports and derives links from careers', async () => {
  await withStore(async store => {
    store.putCareer(career);
    store.putDocument({ ...document, bytes: undefined, recordIds: undefined, storageName: 'local_original.txt' });
    await writeFile(join(store.dataDir, 'originals', 'local_original.txt'), bytes);
    const archive = await exportBackup(store, ['career_one']);
    const result = await readBackupFile(file(archive));
    assert.deepEqual(result.documents[0].recordIds, ['career_one']);
    assert.deepEqual(result.documents[0].bytes, bytes);
    assert.equal(result.careers[0].evidenceStatus, 'attached');
  });
});

test('restore rejects missing links, unexpected originals, changed hashes, and noncanonical paths', async () => {
  const missing = manifest(); missing.careers[0] = { ...career, documentIds: ['missing_document'] };
  await assert.rejects(() => zipFor(missing).then(input => readBackupFile(file(input))), /존재하지 않는 증빙/);
  await assert.rejects(() => zipFor(manifest(), { 'originals/unlisted.txt': 'extra' }).then(input => readBackupFile(file(input))), /목록에 없는/);
  const modifiedHash = manifest(); modifiedHash.documents[0].sha256 = '0'.repeat(64);
  await assert.rejects(() => zipFor(modifiedHash).then(input => readBackupFile(file(input))), /SHA-256/);
  await assert.rejects(() => zipFor(manifest(), { '../escape.txt': 'unsafe' }).then(input => readBackupFile(file(input))), /안전하지/);
  const badLinks = manifest(); badLinks.documents[0].recordIds = ['forged_link'];
  const result = await readBackupFile(file(await zipFor(badLinks)));
  assert.deepEqual(result.documents[0].recordIds, ['career_one']);
});

test('restore verifies CRC and bounds before accepting archive metadata', async () => {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, careers: [normalizeCareer({ id: 'one', title: 'original-title' })], documents: [] }));
  const crcCorrupt = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  crcCorrupt[crcCorrupt.indexOf('original-title')] = 'O'.charCodeAt(0);
  await assert.rejects(() => readBackupFile(file(crcCorrupt)), /CRC/);
  const oversized = await zip.generateAsync({ type: 'nodebuffer' });
  const central = oversized.readUInt32LE(oversized.length - 22 + 16);
  oversized.writeUInt32LE(6 * 1024 * 1024, central + 24);
  await assert.rejects(() => readBackupFile(file(oversized)), /용량/);
  await assert.rejects(() => readBackupFile({ size: 201 * 1024 * 1024, arrayBuffer() { throw new Error('must not read'); } }), /200MB/);
});

test('streamed inflation rejects entries whose declared size understates actual output', async () => {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, careers: [], documents: [], padding: 'x'.repeat(10_000) }));
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const central = archive.readUInt32LE(archive.length - 22 + 16);
  archive.writeUInt32LE(1, 22);
  archive.writeUInt32LE(1, central + 24);
  await assert.rejects(() => readBackupFile(file(archive)), /실제 압축 해제 용량/);
});

test('ZIP creation and restore share calendar and datePrecision validation with browser writes', async () => {
  for (const patch of [
    { startDate: '2026-02-30', datePrecision: 'day' },
    { datePrecision: 'week' },
    { startDate: '2026-03-01', endDate: '2026-02-28', datePrecision: 'day' },
  ]) {
    const invalidCareer = { ...career, ...patch };
    await assert.rejects(() => createBackupBlob({ careers: [invalidCareer], documents: [document] }));
    const invalidManifest = manifest(); invalidManifest.careers = [invalidCareer];
    await assert.rejects(() => zipFor(invalidManifest).then(input => readBackupFile(file(input))));
  }
  const validLeapYear = { ...career, startDate: '2024-02-29', datePrecision: 'day' };
  const blob = await createBackupBlob({ careers: [validLeapYear], documents: [document] });
  const result = await readBackupFile(file(await blob.arrayBuffer()));
  assert.equal(result.careers[0].startDate, '2024-02-29');
});

const driveSnapshot = () => ({
  format: 'career-drive-snapshot', version: 1, createdAt: '2026-01-01T00:00:00.000Z', careers: [career],
  documents: [{ ...document, bytes: undefined, driveFileId: 'drive_file_0000001' }],
});
const jsonFile = data => new File([JSON.stringify(data)], 'career-snapshot.json', { type: 'application/json' });

test('Drive JSON snapshots return normalized metadata without credentials or file contents', async () => {
  const snapshot = driveSnapshot();
  snapshot.refreshToken = 'must-not-preserve';
  snapshot.documents[0].accessToken = 'must-not-preserve';
  snapshot.documents[0].text = 'x'.repeat(30_000);
  snapshot.documents[0].recordIds = ['forged_career'];
  const restored = await readDriveSnapshotFile(jsonFile(snapshot));
  assert.deepEqual(restored.careers, [career]);
  assert.equal(restored.documents[0].sha256, hash);
  assert.equal(restored.documents[0].driveFileId, 'drive_file_0000001');
  assert.equal(restored.documents[0].text.length, 24_000);
  assert.deepEqual(restored.documents[0].recordIds, ['career_one']);
  assert.equal('bytes' in restored.documents[0], false);
  assert.equal(JSON.stringify(restored).includes('must-not-preserve'), false);
});

test('Drive snapshot references can exceed the aggregate ZIP size limit', async () => {
  const snapshot = driveSnapshot();
  snapshot.documents = Array.from({ length: 9 }, (_, index) => ({ ...snapshot.documents[0], id: `doc_${index}`, size: 25 * 1024 * 1024, sha256: (index + 1).toString(16).padStart(64, '0'), driveFileId: `drive_file_${index}` }));
  snapshot.careers = [{ ...career, documentIds: snapshot.documents.map(doc => doc.id) }];
  const restored = await readDriveSnapshotFile(jsonFile(snapshot));
  assert.equal(restored.documents.length, 9);
  assert.ok(restored.documents.reduce((total, doc) => total + doc.size, 0) > 200 * 1024 * 1024);
});

test('Drive snapshot rejects wrong formats, unsafe IDs, duplicate records, missing links and invalid career dates', async () => {
  const modifications = [
    snapshot => { snapshot.format = 'career-archive'; },
    snapshot => { snapshot.version = 2; },
    snapshot => { delete snapshot.createdAt; },
    snapshot => { snapshot.careers.push(snapshot.careers[0]); },
    snapshot => { snapshot.documents.push({ ...snapshot.documents[0] }); },
    snapshot => { snapshot.documents.push({ ...snapshot.documents[0], id: 'other', driveFileId: 'other_drive_file' }); },
    snapshot => { snapshot.documents[0].id = 'folder/foreign_document'; },
    snapshot => { snapshot.documents[0].driveFileId = '../foreign_drive_file'; },
    snapshot => { delete snapshot.documents[0].driveFileId; },
    snapshot => { snapshot.documents[0].sha256 = 'not-a-checksum'; },
    snapshot => { snapshot.documents[0].name = 'unsafe.exe'; },
    snapshot => { snapshot.documents[0].size = 25 * 1024 * 1024 + 1; },
    snapshot => { snapshot.documents[0].size = -1; },
    snapshot => { snapshot.careers[0] = { ...career, documentIds: ['missing'] }; },
    snapshot => { snapshot.careers[0] = { ...career, startDate: '2026-02-30' }; },
    snapshot => { snapshot.careers[0] = { ...career, datePrecision: 'week' }; },
  ];
  for (const modify of modifications) {
    const snapshot = driveSnapshot(); modify(snapshot);
    await assert.rejects(() => readDriveSnapshotFile(jsonFile(snapshot)));
  }
  await assert.rejects(() => readDriveSnapshotFile({ name: 'oversized.json', size: 6 * 1024 * 1024, arrayBuffer() { throw new Error('must not read'); } }), /5MB/);
  await assert.rejects(() => readDriveSnapshotFile(new File(['{}'], 'wrong.zip')), /JSON/);
});

test('HTML originals and favorite metadata round-trip through browser ZIP and local restore unchanged',async()=>{
  const content=Buffer.from('<!doctype html><html><head><title>가상 수업</title></head><body><h1>수학</h1><script>window.test=1</script></body></html>');
  const htmlDoc={...document,name:'수학.HTML',mime:'text/html',size:content.length,sha256:createHash('sha256').update(content).digest('hex'),bytes:new Uint8Array(content)};
  const {normalizeWorkspaceItem}=await import('../shared/workspace.mjs');
  const item=normalizeWorkspaceItem({id:'favorite_html',kind:'material',title:'수학',format:'HTML',favorite:true,fileUrl:'https://drive.google.com/file/d/sample123/view',sourceFile:{name:htmlDoc.name,size:content.length,sha256:htmlDoc.sha256}});
  const workspace={schemaVersion:1,items:[item],links:[{from:'career:career_one',to:'material:favorite_html'}],revision:0};
  const blob=await createBackupBlob({careers:[career],documents:[htmlDoc],workspace});
  const archive=Buffer.from(await blob.arrayBuffer());
  const restored=await readBackupFile(file(archive));
  assert.deepEqual(Buffer.from(restored.documents[0].bytes),content);assert.equal(restored.workspace.items[0].favorite,true);
  await withStore(async store=>{
    await restoreBackup(store,archive);
    const next=await readBackupFile(file(await exportBackup(store)));
    assert.deepEqual(Buffer.from(next.documents[0].bytes),content);assert.equal(next.workspace.items[0].format,'HTML');assert.equal(next.workspace.items[0].favorite,true);assert.deepEqual(next.workspace.links,workspace.links);
  });
});
