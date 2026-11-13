import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `export * from './src/workspace/material-original';` }, bundle: true, write: false, platform: 'browser', format: 'esm' });
const { materialHtmlPreview, materialAudioPreview } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(name, text, format = 'HTML') {
  const bytes = Buffer.from(text), sha256 = digest(bytes);
  const item = { id: 'material-fixture', kind: 'material', title: '가상 자료', format, fileUrl: '', sourceFile: { name, size: bytes.length, sha256 } };
  const document = { id: 'document-fixture', name, size: bytes.length, sha256, mime: 'application/octet-stream', recordIds: [], createdAt: '2026-11-14T00:00:00.000Z' };
  return { item, document, bytes };
}

test('a newly archived HTML file without a public link is read by document identity and returned as text without execution', async () => {
  const html = '<!doctype html><html><title>합성 수업</title><script>globalThis.originalPreviewExecuted = true</script><body>자료</body></html>';
  const f = fixture('수업.html', html); const reads = [];
  const value = await materialHtmlPreview(f.item, [f.document], async original => { reads.push(original.id); return new Blob([f.bytes]); });
  assert.equal(value, html);
  assert.deepEqual(reads, ['document-fixture']);
  assert.equal(globalThis.originalPreviewExecuted, undefined);
  // The existing HTML-preview component performs isolation/sanitization later;
  // this adapter only validates identity and decodes the source.
  assert.match(value, /<script>/);
});

test('the original reader rejects byte-length and SHA-256 mismatches instead of using a legacy fallback', async () => {
  const f = fixture('수업.html', '<!doctype html><p>safe</p>'); let fallbackCalls = 0;
  const legacy = async () => { fallbackCalls++; return '<p>legacy</p>'; };
  await assert.rejects(materialHtmlPreview(f.item, [f.document], async () => new Blob(['short']), legacy), /크기/);
  const altered = Buffer.from(f.bytes); altered[altered.length - 1] ^= 1;
  await assert.rejects(materialHtmlPreview(f.item, [f.document], async () => new Blob([altered]), legacy), /확인 정보/);
  assert.equal(fallbackCalls, 0);
});

test('size and source metadata bounds reject invalid previews before reading bytes', async () => {
  const f = fixture('수업.html', '<!doctype html><p>safe</p>'); let reads = 0;
  const read = async () => { reads++; throw new Error('must not read'); };
  await assert.rejects(materialHtmlPreview({ ...f.item, sourceFile: { ...f.item.sourceFile, size: 2 * 1024 * 1024 + 1 } }, [f.document], read), /2 MB/);
  await assert.rejects(materialHtmlPreview({ ...f.item, sourceFile: { ...f.item.sourceFile, sha256: 'invalid' } }, [f.document], read), /확인 정보/);
  await assert.rejects(materialHtmlPreview({ ...f.item, sourceFile: { ...f.item.sourceFile, size: 0 } }, [f.document], read), /확인 정보/);
  await assert.rejects(materialAudioPreview({ ...f.item, format: '오디오', sourceFile: { ...f.item.sourceFile, name: '가상.wav', size: 25 * 1024 * 1024 + 1 } }, [], read), /확인 정보/);
  assert.equal(reads, 0);
});

test('only a missing original can use an explicitly provided legacy reader', async () => {
  const f = fixture('수업.html', '<!doctype html><p>safe</p>'); let reads = 0, legacyReads = 0;
  const read = async () => { reads++; return new Blob([f.bytes]); };
  await assert.rejects(materialHtmlPreview(f.item, [], read), /원본 파일을 찾지/);
  const result = await materialHtmlPreview(f.item, [], read, async () => { legacyReads++; return '<p>legacy</p>'; });
  assert.equal(result, '<p>legacy</p>'); assert.equal(reads, 0); assert.equal(legacyReads, 1);
  await assert.rejects(materialHtmlPreview(f.item, [f.document], async () => { throw new Error('인증 실패'); }, async () => { legacyReads++; return ''; }), /인증 실패/);
  assert.equal(legacyReads, 1);
});

test('audio originals validate their header and return the expected MIME with byte-identical content', async () => {
  const f = fixture('가상 효과음.WAV', 'RIFF\x24\0\0\0WAVEfmt ', '오디오');
  const result = await materialAudioPreview(f.item, [f.document], async original => { assert.equal(original.id, f.document.id); return new Blob([f.bytes], { type: 'application/octet-stream' }); });
  assert.equal(result.type, 'audio/wav');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), f.bytes);
  const bad = fixture('가상.wav', 'not an audio file', '오디오');
  await assert.rejects(materialAudioPreview(bad.item, [bad.document], async () => new Blob([bad.bytes])), /형식/);
  await assert.rejects(materialAudioPreview({ ...f.item, sourceFile: { ...f.item.sourceFile, name: 'wrong.pdf' } }, [f.document], async () => { throw new Error('must not read'); }), /오디오만/);
});

test('a validated digest does not make non-HTML bytes safe to preview', async () => {
  const f = fixture('가상.html', 'ordinary plain text');
  await assert.rejects(materialHtmlPreview(f.item, [f.document], async () => new Blob([f.bytes])), /HTML 원본의 형식/);
});
