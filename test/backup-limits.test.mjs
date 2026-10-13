import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Store, normalizeCareer } from '../server/store.mjs';
import { exportBackup, restoreBackup } from '../server/backup.mjs';

async function withStore(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'career-backup-limits-'));
  const store = new Store(directory, null);
  try { await fn(store); } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}

test('export refuses an oversized manifest and an allowed large manifest restores successfully', async () => {
  await withStore(async (store) => {
    store.transaction(() => {
      for (let index = 0; index < 550; index++) store.putCareer(normalizeCareer({ id: `career_${index}`, title: `경력 ${index}`, description: 'x'.repeat(10000) }));
    });
    await assert.rejects(() => exportBackup(store), error => error.status === 413 && /5MB/.test(error.message));
    assert.equal(store.careers().length, 550);
    store.transaction(() => {
      for (const career of store.careers()) store.putCareer({ ...career, description: 'x'.repeat(8000) });
    });
    const output = await exportBackup(store);
    const zip = await JSZip.loadAsync(output, { checkCRC32: true });
    const bytes = (await zip.file('manifest.json').async('nodebuffer')).length;
    assert.ok(bytes > 4 * 1024 * 1024 && bytes < 5 * 1024 * 1024);
    const result = await restoreBackup(store, output);
    assert.equal(result.careers, 550);
    assert.equal(store.career('career_100').description.length, 8000);
  });
});

test('the 200MB inflated export limit includes manifest metadata before loading originals into memory', async () => {
  await withStore(async (store) => {
    const fileSize = 25 * 1024 * 1024;
    const zeroTail = Buffer.alloc(fileSize - 1);
    for (let index = 0; index < 8; index++) {
      const storageName = `document_${index}.txt`;
      const file = await open(join(store.dataDir, 'originals', storageName), 'wx', 0o600);
      try { await file.write(Buffer.from([index])); await file.truncate(fileSize); } finally { await file.close(); }
      const sha256 = createHash('sha256').update(Buffer.from([index])).update(zeroTail).digest('hex');
      store.putDocument({ id: `document_${index}`, storageName, name: storageName, mime: 'text/plain', size: fileSize, sha256, text: '', analysisStatus: 'text-ready', createdAt: '2026-01-01T00:00:00.000Z' });
    }
    // Originals alone fit exactly; adding their manifest makes the ZIP
    // impossible to restore under the same 200MB inflated limit.
    await assert.rejects(() => exportBackup(store), error => error.status === 413 && /200MB/.test(error.message));
    assert.equal(store.documents().length, 8);
  });
});

test('restore rejects a CRC-corrupted but valid JSON manifest without replacing existing data', async () => {
  await withStore(async (store) => {
    store.putCareer(normalizeCareer({ id: 'keep', title: '기존 경력' }));
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, careers: [normalizeCareer({ id: 'replace', title: 'original-career' })], documents: [] }));
    const input = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const position = input.indexOf(Buffer.from('original-career'));
    assert.ok(position >= 0);
    input[position] = 'O'.charCodeAt(0);
    await assert.rejects(() => restoreBackup(store, input), error => error.status === 400 && /CRC/.test(error.message));
    assert.deepEqual(store.careers().map(career => career.id), ['keep']);
  });
});

test('restore rejects oversized declared ZIP members before inflation and leaves existing data intact', async () => {
  await withStore(async (store) => {
    store.putCareer(normalizeCareer({ id: 'keep', title: '기존 경력' }));
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, careers: [], documents: [] }));
    const input = await zip.generateAsync({ type: 'nodebuffer' });
    const directory = input.readUInt32LE(input.length - 22 + 16);
    input.writeUInt32LE(6 * 1024 * 1024, directory + 24);
    await assert.rejects(() => restoreBackup(store, input), error => error.status === 400 && /용량/.test(error.message));
    assert.equal(store.careers()[0].id, 'keep');
  });
});
