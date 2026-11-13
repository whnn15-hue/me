import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { mutateWorkspace, normalizeWorkspaceItem } from '../shared/workspace.mjs';

const output = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `export * from './src/workspace/research-file-import';` }, bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{ name: 'no-network', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/(api|cloud)$/ }, ({ path }) => ({ path, namespace: 'offline' }));
    builder.onLoad({ filter: /.*/, namespace: 'offline' }, ({ path }) => ({ loader: 'js', contents: path.endsWith('api') ? `export const api=()=>{throw Error('Unexpected network request')};` : `export const readyCloudUser=()=>{throw Error('Unexpected authentication')};export const cloudUserError=()=>{throw Error('Unexpected authentication')};` }));
  } }] });
const { archiveDroppedFiles, validateFileBatch, researchFileDraft } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const file = (name, contents = '가상 연구 자료입니다.') => new File([contents], name, { type: 'text/plain' });
const options = { purpose: 'research', researchType: '보고서' };

function fixture(initial = []) {
  const state = { workspace: { schemaVersion: 1, items: initial, links: [], revision: 0 }, documents: [] };
  const uploaded = [], saved = [];
  const deps = {
    readState: async () => structuredClone(state),
    uploadOriginal: async value => {
      uploaded.push(value.name);
      const bytes = Buffer.from(await value.arrayBuffer());
      const document = { id: `doc-${uploaded.length}`, name: value.name, size: bytes.length, mime: value.type, createdAt: '2026-11-14T00:00:00.000Z', recordIds: [], sha256: hash(bytes), text: /\.txt$/.test(value.name) ? bytes.toString('utf8') : '' };
      state.documents.push(document); return document;
    },
    saveItem: async (item, expectedRevision) => {
      saved.push(structuredClone(item));
      state.workspace = mutateWorkspace(state.workspace, { operation: 'create', item: { ...item, id: `new-${saved.length}` }, links: [], expectedRevision }, []);
      return structuredClone(state.workspace);
    },
  };
  return { state, deps, uploaded, saved };
}

test('research suggestions use explicit source metadata and the visible folder overrides inferred type', () => {
  const draft = researchFileDraft('2026_수업혁신사례연구대회_계획서.txt', '대회명: 가상 연구대회\n작성연도: 2025\n작성자: 가상 작성자\n수학 활동의 설계\n참고 문헌 2019년');
  assert.equal(draft.title, '2026 수업혁신사례연구대회 계획서');
  assert.equal(draft.researchType, '참고자료'); assert.equal(draft.date, '2025');
  assert.equal(draft.eventName, '가상 연구대회'); assert.equal(draft.author, '가상 작성자');
  assert.ok(draft.tags.includes('수학'));
  assert.equal(researchFileDraft('보고서.txt', '참고 문헌에 2019년 연구가 있습니다.').date, '');
  assert.equal(researchFileDraft('2026 발표자료.txt', '', '보고서').researchType, '보고서');
  assert.equal(researchFileDraft('연구보고서 양식.hwp').researchType, '참고자료');
  assert.equal(researchFileDraft('anonymous-deck.pptx').researchType, '참고자료');
});

test('drop batch creates typed research records, keeps original identities and uses each latest revision', async () => {
  const f = fixture(); const progress = [];
  const result = await archiveDroppedFiles([
    file('2026_수업혁신사례연구대회_계획서.txt', '수학 연구\n작성자: 가상 교사'),
    file('2025_현장교육연구대회_발표자료.txt', '과학 발표\n대회명: 가상대회'),
  ], { ...f.deps, onProgress: (done, total) => progress.push([done, total]) }, options);
  assert.deepEqual(result, { added: 2, duplicates: 0, elsewhere: 0, ids: ['new-1', 'new-2'] });
  assert.equal(f.state.workspace.revision, 2);
  assert.ok(f.state.workspace.items.every(item => item.purpose === 'research' && item.researchType === '보고서'));
  assert.deepEqual(f.state.workspace.items.map(item => item.date), ['2026', '2025']);
  assert.deepEqual(f.state.workspace.items.map(item => item.sourceFile.sha256), f.state.documents.map(document => document.sha256));
  assert.deepEqual(progress.at(-1), [2, 2]);
});

test('same-folder duplicates retain edits, while a new folder gets its own entry reusing a legacy original link', async () => {
  const bytes = '수정해서 보관한 가상 파일', source = { name: 'old.txt', size: Buffer.byteLength(bytes), sha256: hash(Buffer.from(bytes)) };
  const original = normalizeWorkspaceItem({ id: 'existing', kind: 'material', purpose: 'research', researchType: '계획서', title: '사용자가 고친 제목', summary: '남겨 둔 메모', sourceFile: source, fileUrl: 'https://drive.google.com/file/d/synthetic-file/view' });
  const f = fixture([original]), before = structuredClone(f.state);
  const result = await archiveDroppedFiles([file('새파일명_2026.txt', bytes)], f.deps, options);
  assert.deepEqual(result, { added: 1, duplicates: 0, elsewhere: 0, ids: ['new-1'] });
  assert.deepEqual(f.state.workspace.items[0], before.workspace.items[0]); assert.deepEqual(f.uploaded, []);
  assert.equal(f.state.workspace.items[1].researchType, '보고서');
  assert.equal(f.state.workspace.items[1].fileUrl, original.fileUrl);
  assert.deepEqual(f.state.workspace.items[1].sourceFile, original.sourceFile);
  const same = await archiveDroppedFiles([file('다른이름.txt', bytes)], f.deps, { ...options, researchType: '참고자료' });
  assert.deepEqual(same.ids, ['existing']); assert.equal(same.elsewhere, 0);
  assert.deepEqual(f.state.workspace.items[0], original); assert.equal(f.state.workspace.items.length, 2);
});

test('all size and format validation completes before writes, including mismatched HTML extensions', async () => {
  const f = fixture();
  await assert.rejects(archiveDroppedFiles([file('valid.txt'), file('spoof.pdf', '<html><script>throw new Error()</script></html>')], f.deps, options), /확장자/);
  assert.deepEqual(f.uploaded, []); assert.deepEqual(f.saved, []);
  assert.throws(() => validateFileBatch([]), /1~10/);
  assert.throws(() => validateFileBatch(Array(11).fill({ name: 'x', size: 1 })), /1~10/);
  assert.throws(() => validateFileBatch([{ name: 'empty', size: 0 }]), /25 MB/);
  assert.throws(() => validateFileBatch([{ name: 'large', size: 25 * 1024 * 1024 + 1 }]), /25 MB/);
  assert.throws(() => validateFileBatch(Array(9).fill({ name: 'x', size: 25 * 1024 * 1024 })), /200 MB/);
});

test('a partial metadata failure retains uploaded originals and retry reuses them without overwriting completed records', async () => {
  const f = fixture(), files = [file('첫보고서.txt', '첫 연구 자료'), file('둘째보고서.txt', '둘째 연구 자료')];
  const save = f.deps.saveItem; let fail = true;
  f.deps.saveItem = async (item, revision) => {
    if (fail && item.title === '둘째보고서') throw new Error('가상 저장 실패');
    return save(item, revision);
  };
  await assert.rejects(archiveDroppedFiles(files, f.deps, options), /앞서 저장한 1개 자료는 그대로/);
  assert.equal(f.state.documents.length, 2); assert.equal(f.state.workspace.items.length, 1);
  f.state.workspace.items[0].summary = '보존할 사용자 메모';
  fail = false;
  const result = await archiveDroppedFiles(files, f.deps, options);
  assert.equal(result.added, 1); assert.equal(result.duplicates, 1);
  assert.equal(f.uploaded.length, 2); assert.equal(f.state.documents.length, 2);
  assert.equal(f.state.workspace.items[0].summary, '보존할 사용자 메모');
});

test('a lost create response is reconciled by reading, never by replaying the create or deleting the original', async () => {
  const f = fixture(), save = f.deps.saveItem;
  f.deps.saveItem = async (item, revision) => { await save(item, revision); throw new Error('응답 누락'); };
  const result = await archiveDroppedFiles([file('보고서.txt')], f.deps, options);
  assert.equal(result.duplicates, 1); assert.deepEqual(result.ids, ['new-1']);
  assert.equal(f.state.workspace.items.length, 1); assert.equal(f.state.documents.length, 1); assert.equal(f.saved.length, 1);
});

test('HTML metadata stays text, and school or teaching-library placement follows the visible folder', async () => {
  const f = fixture();
  const html = '<!doctype html><title>가상 수학 자료</title><script>globalThis.executed = true</script><p>수학 학습</p>';
  const lesson = await archiveDroppedFiles([file('수업.html', html)], f.deps, { purpose: 'classroom', schoolSection: 'lesson' });
  const saved = f.state.workspace.items.find(item => item.id === lesson.ids[0]);
  assert.equal(saved.title, '가상 수학 자료'); assert.equal(saved.schoolSection, 'lesson');
  assert.equal(saved.purpose, 'classroom'); assert.equal(globalThis.executed, undefined);
  assert.doesNotMatch(saved.summary, /executed|script/);
  const second = fixture();
  await archiveDroppedFiles([file('효과음 설명.txt', '수업에 쓰는 효과음 설명')], second.deps, { purpose: 'lecture', library: 'learning' });
  assert.equal(second.state.workspace.items[0].resourceType, 'lecture');
});

test('the selected video folder overrides filename hints and reuses a source already present in another video folder', async () => {
  const bytes = Buffer.from('RIFF\x24\0\0\0WAVEfmt '), input = new File([bytes], '발표 효과음.wav', { type: 'audio/wav' });
  const sourceFile = { name: input.name, size: bytes.length, sha256: hash(bytes) };
  const sound = normalizeWorkspaceItem({ id: 'sound-original', kind: 'material', purpose: 'lecture', resourceType: 'sound', title: '이전 효과음', format: '오디오', sourceFile, fileUrl: 'https://drive.google.com/file/d/synthetic-audio/view' });
  const f = fixture([sound]);
  const result = await archiveDroppedFiles([input], f.deps, { purpose: 'lecture', library: 'video', resourceType: 'music' });
  assert.equal(result.added, 1); assert.equal(f.uploaded.length, 0);
  assert.equal(f.state.workspace.items[1].resourceType, 'music');
  assert.equal(f.state.workspace.items[1].fileUrl, sound.fileUrl);
  assert.deepEqual(f.state.workspace.items[0], sound);
  const duplicate = await archiveDroppedFiles([input], f.deps, { purpose: 'lecture', library: 'video', resourceType: 'music' });
  assert.equal(duplicate.added, 0); assert.equal(duplicate.duplicates, 1);
  await assert.rejects(archiveDroppedFiles([input], f.deps, { purpose: 'lecture', library: 'learning', resourceType: 'music' }), /분류/);
});
