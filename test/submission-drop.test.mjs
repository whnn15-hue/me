import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { emptyWorkspace, mutateWorkspace, normalizeWorkspaceItem } from '../shared/workspace.mjs';

const bundle = await build({ entryPoints: ['src/reuse/submission-drop.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { archiveSubmissionFiles } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const file = (name, contents = '로컬 검증용 원본') => new File([contents], name, { type: 'text/plain' });

function fixture() {
  let workspace = emptyWorkspace(), documents = [], uploads = [], saves = [];
  const dependencies = {
    validate: async () => {},
    readWorkspace: async () => structuredClone(workspace),
    readDocuments: async () => structuredClone(documents),
    upload: async file => {
      const bytes = Buffer.from(await file.arrayBuffer());
      const document = { id: `document-${documents.length}`, name: file.name, size: file.size, mime: file.type,
        sha256: createHash('sha256').update(bytes).digest('hex'), recordIds: [], createdAt: new Date().toISOString() };
      uploads.push({ document, bytes }); documents.push(document);
      // Production original uploads may advance the same revision.
      workspace = { ...workspace, revision: workspace.revision + 1 };
      return document;
    },
    save: async (item, expectedRevision) => {
      saves.push({ item, expectedRevision });
      workspace = mutateWorkspace(workspace, { operation: 'create', item, id: item.id, links: [], expectedRevision }, []);
    },
  };
  return { dependencies, get workspace() { return workspace; }, get documents() { return documents; }, uploads, saves,
    setWorkspace: value => { workspace = value; } };
}

test('submission screen drop retains its destination and original bytes without invented dates or submission status', async () => {
  const state = fixture(), original = file('2024_수업_발표_보고서.txt');
  const result = await archiveSubmissionFiles([original], state.dependencies);
  assert.deepEqual(result, { saved: 1, duplicates: 0, completed: 1 });
  const item = state.workspace.items[0];
  assert.equal(item.kind, 'submission');
  assert.equal(item.title, '2024_수업_발표_보고서');
  assert.equal(item.status, 'preparing');
  assert.equal(item.year, ''); assert.equal(item.submittedOn, ''); assert.equal(item.competition, '');
  assert.deepEqual(item.documentIds, ['document-0']); assert.deepEqual(item.tags, ['발표']);
  assert.equal(state.saves[0].expectedRevision, 1);
  assert.deepEqual(state.uploads[0].bytes, Buffer.from(await original.arrayBuffer()));
  const unchanged = structuredClone(state.workspace);
  assert.deepEqual(await archiveSubmissionFiles([original, original], state.dependencies), { saved: 0, duplicates: 2, completed: 2 });
  assert.equal(state.uploads.length, 1); assert.deepEqual(state.workspace, unchanged);
});

test('submission import validates the entire batch before writing and honors file count, size and cancellation', async () => {
  const state = fixture(); let checks = 0;
  state.dependencies.validate = async current => { checks++; if (current.name.endsWith('.exe')) throw new Error('지원하지 않는 형식'); };
  await assert.rejects(() => archiveSubmissionFiles([file('먼저.txt'), file('나중.exe')], state.dependencies), /지원하지/);
  assert.equal(checks, 2); assert.equal(state.uploads.length, 0); assert.equal(state.saves.length, 0);
  await assert.rejects(() => archiveSubmissionFiles(Array.from({ length: 11 }, () => file('a.txt')), state.dependencies), /1~10/);
  await assert.rejects(() => archiveSubmissionFiles([file('빈.txt', '')], state.dependencies), /비어/);
  await assert.rejects(() => archiveSubmissionFiles([{ name: 'large.txt', size: 25 * 1024 * 1024 + 1 }], state.dependencies), /25 MB/);
  assert.deepEqual(await archiveSubmissionFiles([file('중단.txt')], { ...state.dependencies, stopped: () => true }), { saved: 0, duplicates: 0, completed: 0 });
  assert.equal(state.uploads.length, 0);
});

test('submission retry after a lost commit response finds the saved hash and never duplicates or deletes its original', async () => {
  const state = fixture(), original = file('재시도.txt');
  const save = state.dependencies.save;
  state.dependencies.save = async (...args) => { await save(...args); throw new Error('응답을 받지 못했습니다'); };
  await assert.rejects(() => archiveSubmissionFiles([original], state.dependencies), /응답/);
  assert.equal(state.workspace.items.length, 1); assert.equal(state.documents.length, 1);
  state.dependencies.save = save;
  assert.deepEqual(await archiveSubmissionFiles([original], state.dependencies), { saved: 0, duplicates: 1, completed: 1 });
  assert.equal(state.uploads.length, 1); assert.equal(state.saves.length, 1);
});

test('a concurrent revision conflict retains the original and never overwrites another submitted record', async () => {
  const state = fixture();
  const legacy = normalizeWorkspaceItem({ id: 'legacy', kind: 'submission', title: '기존 제출본', status: 'submitted', year: '2025' });
  state.setWorkspace({ ...emptyWorkspace(), items: [legacy] });
  const save = state.dependencies.save;
  state.dependencies.save = async (item, revision) => {
    state.setWorkspace({ ...state.workspace, revision: state.workspace.revision + 1 });
    await save(item, revision);
  };
  await assert.rejects(() => archiveSubmissionFiles([file('충돌.txt')], state.dependencies), /변경/);
  assert.equal(state.documents.length, 1);
  assert.deepEqual(state.workspace.items, [legacy]);
});

test('hash duplicates already connected to a manually named submission reuse that record', async () => {
  const state = fixture(), original = file('수동으로 보관했던 파일.txt');
  const document = await state.dependencies.upload(original);
  const legacy = normalizeWorkspaceItem({ id: 'manual', kind: 'submission', title: '내가 정한 제목', documentIds: [document.id] });
  state.setWorkspace({ ...state.workspace, items: [legacy] });
  assert.deepEqual(await archiveSubmissionFiles([original], state.dependencies), { saved: 0, duplicates: 1, completed: 1 });
  assert.equal(state.uploads.length, 1); assert.equal(state.saves.length, 0);
  assert.deepEqual(state.workspace.items, [legacy]);
});
