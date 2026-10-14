import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';
import { normalizeWorkspace, normalizeWorkspaceItem, workspaceToRows } from '../shared/workspace.mjs';

const runtimeKey = '__classroomMaterialImportFixture';
const workingDirectory = new URL('..', import.meta.url).pathname;
const virtualFirestore = `
const state = () => globalThis.${runtimeKey};
export const getFirestore = () => ({});
export const doc = (parent, ...parts) => ({ path: [parent.path, ...parts].filter(Boolean).join('/') });
export const collection = doc;
const row = reference => ({ id: reference.path.split('/').at(-1), data: () => structuredClone(state().rows.get(reference.path)) });
export async function getDocFromServer(reference) { state().reads++; return row(reference); }
export async function getDocsFromServer(reference) {
  const prefix = reference.path + '/';
  return { docs: [...state().rows.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).map(path => row({ path })) };
}
export function writeBatch() {
  const writes = [];
  return {
    set(reference, value) { writes.push([reference.path, structuredClone(value)]); },
    async commit() {
      const current = state(); current.batches.push(writes);
      if (current.failBatch) throw new Error('staging failed');
      for (const [path, value] of writes) current.rows.set(path, value);
    },
  };
}
export async function runTransaction(database, callback) {
  const current = state();
  await current.beforeTransaction?.();
  const attempt = async () => {
    const writes = [];
    const result = await callback({
      async get(reference) { return row(reference); },
      set(reference, value, options) {
        writes.push([reference.path, options?.merge ? { ...current.rows.get(reference.path), ...structuredClone(value) } : structuredClone(value)]);
      },
      delete(reference) { writes.push([reference.path, undefined]); },
    });
    return { writes, result };
  };
  let pending = await attempt();
  if (current.afterFirstAttempt) { await current.afterFirstAttempt(pending.writes); pending = await attempt(); }
  for (const [path, value] of pending.writes) value === undefined ? current.rows.delete(path) : current.rows.set(path, value);
  current.transactions.push(pending.writes);
  if (current.uncertainCommit) throw new Error('commit response unavailable');
  return pending.result;
}
`;
const virtualCloud = `
export const getFirebaseApp = () => ({});
export async function readyCloudUser() { return { uid: 'material_owner', email: 'synthetic@example.com', emailVerified: true, providerData: [{ providerId: 'google.com' }] }; }
`;
const virtualDrive = `
const state = () => globalThis.${runtimeKey};
export async function sha256(bytes) {
  const source = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', source)), x => x.toString(16).padStart(2, '0')).join('');
}
export async function validateDriveUploadFile(file) {
  state().validated.push(file.name);
  await state().onValidate?.(file);
  if (!file.name.endsWith('.txt')) throw new Error('unsupported synthetic original');
  return 'text/plain';
}
export async function uploadDriveFile(file, kind, digest) {
  const current = state(), index = current.uploads.length, id = 'new_drive_original_' + index;
  const bytes = new Uint8Array(await file.arrayBuffer());
  current.uploads.push({ id, name: file.name, kind, digest, bytes });
  await current.onUpload?.(file, index);
  if (current.failUploadAt === index) throw new Error('upload failed');
  return { id, name: file.name, mimeType: file.type, sha256: digest };
}
export async function trashDriveFile(id) { state().trashed.push(id); }
`;
const bundle = await build({
  stdin: { contents: `export * from './src/free/material-import.ts'; export { readFreeSnapshot } from './src/free/store.ts'; export { readBackupFile } from './src/free/backup.ts'; export { normalizeCareer, normalizeDocumentRecord } from './src/free/normalize.ts';`, resolveDir: workingDirectory },
  bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{ name: 'isolated-classroom-runtime', setup(builder) {
    builder.onResolve({ filter: /^(?:firebase\/firestore|\.\.\/cloud|\.\/drive)$/ }, args => ({ path: args.path, namespace: 'material-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'material-test' }, args => ({ contents: args.path === 'firebase/firestore' ? virtualFirestore : args.path === './drive' ? virtualDrive : virtualCloud, loader: 'js' }));
  } }],
});
const directory = await mkdtemp(join(tmpdir(), 'classroom-material-tests-'));
const modulePath = join(directory, 'material-import.mjs');
await writeFile(modulePath, bundle.outputFiles[0].contents);
const { applyMaterialImport, readMaterialImportFile, readBackupFile, readFreeSnapshot, normalizeCareer, normalizeDocumentRecord } = await import(pathToFileURL(modulePath).href);
test.after(async () => { delete globalThis[runtimeKey]; await rm(directory, { recursive: true, force: true }); });

const rootPath = 'careerArchives/material_owner';
const pointerPath = `${rootPath}/versions/workspace_v1/documents/__workspace_pointer_v1`;
const stamp = '2026-01-01T00:00:00.000Z';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function original(id) {
  const bytes = new TextEncoder().encode(`synthetic classroom original ${id}`);
  return { id, name: `${id}.txt`, size: bytes.length, mime: 'text/plain', createdAt: stamp, text: 'synthetic preview', analysisStatus: 'reviewed', recordIds: [], sha256: digest(bytes), bytes };
}
function material(id, overrides = {}) {
  return normalizeWorkspaceItem({ id, kind: 'material', purpose: 'classroom', title: `Synthetic ${id}`, format: 'TXT', fileUrl: '', tags: ['synthetic'], createdAt: stamp, updatedAt: stamp, ...overrides });
}
function runtime(extraItems = []) {
  const evidence = { ...normalizeDocumentRecord({ ...original('old_original'), driveFileId: 'existing_drive_original' }), legacyPrivateField: { preserve: true } };
  const career = { ...normalizeCareer({ id: 'old_career', title: 'Keep original career', documentIds: [evidence.id] }), legacyPrivateField: ['preserve'] };
  const existingProject = normalizeWorkspaceItem({ id: 'old_project', kind: 'project', title: 'Existing project', createdAt: stamp, updatedAt: stamp });
  const existingLecture = material('old_lecture', { purpose: 'lecture', title: 'Existing lecture', fileUrl: 'https://drive.google.com/file/d/existing_lecture_file/view' });
  const workspace = normalizeWorkspace({ schemaVersion: 1, items: [existingProject, existingLecture, ...extraItems], links: [{ from: 'career:old_career', to: 'project:old_project' }], revision: 7 }, { careerIds: [career.id] });
  const rows = new Map([
    [rootPath, { activeVersion: 'live_version', revision: 7, preservedRootField: true }],
    [`${rootPath}/versions/live_version/careers/${career.id}`, career],
    [`${rootPath}/versions/live_version/documents/${evidence.id}`, evidence],
    [pointerPath, { id: '__workspace_pointer_v1', rowKind: 'introduce-me-workspace', schemaVersion: 1, activeVersion: 'workspace_live' }],
    ...workspaceToRows(workspace).map(row => [`${rootPath}/versions/workspace_live/documents/${row.id}`, row]),
  ]);
  const state = { rows, reads: 0, uploads: [], validated: [], batches: [], transactions: [], trashed: [], career, evidence, workspace };
  globalThis[runtimeKey] = state;
  return state;
}
async function archive(items = [material('one'), material('two')], mutate = () => {}) {
  const zip = new JSZip(), documents = items.map(item => original(`original_${item.id}`));
  const manifest = { format: 'career-archive', version: 1, careers: [], documents: documents.map(({ bytes, ...document }) => ({ ...document, filePath: `originals/${document.id}.txt` })), materialImport: { format: 'classroom-material-import', version: 1, materials: items.map((item, index) => ({ item, documentId: documents[index].id })) } };
  mutate(manifest);
  zip.file('manifest.json', JSON.stringify(manifest));
  for (const document of documents) zip.file(`originals/${document.id}.txt`, document.bytes);
  return new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], 'classroom-import.zip', { type: 'application/zip' });
}
async function prepared(items) { return readMaterialImportFile(await archive(items)); }
const apply = (input, options = {}) => applyMaterialImport(input, { approvedMaterialIds: input.materials.map(entry => entry.item.id), ...options });
const noWrites = state => { assert.equal(state.uploads.length, 0); assert.equal(state.batches.length, 0); assert.equal(state.transactions.length, 0); assert.deepEqual(state.trashed, []); };

test('classroom packages preserve original bytes and cannot enter full backup restoration', async () => {
  runtime();
  const file = await archive(), result = await readMaterialImportFile(file);
  assert.equal(result.materials.length, 2);
  assert.equal(result.materials[0].item.purpose, 'classroom');
  assert.deepEqual(result.documents[0].bytes, original('original_one').bytes);
  await assert.rejects(readBackupFile(file), /전체 기록 복원/);
});

test('reader rejects mixed archives, unsupported markers and unsafe or duplicate mappings', async () => {
  const state = runtime();
  const mutations = [
    manifest => { delete manifest.materialImport; },
    manifest => { manifest.materialImport.version = 2; },
    manifest => { manifest.evidenceImport = { format: 'career-evidence-import', version: 1 }; },
    manifest => { manifest.workspace = { schemaVersion: 1, items: [], links: [] }; },
    manifest => { manifest.careers = [normalizeCareer({ id: 'unexpected_career', title: 'unexpected', documentIds: [] })]; },
    manifest => { manifest.documents[0].recordIds = ['untrusted_career']; },
    manifest => { manifest.materialImport.materials[0].item.purpose = 'lecture'; },
    manifest => { manifest.materialImport.materials[0].item.id = '../unsafe'; },
    manifest => { manifest.materialImport.materials[0].item.fileUrl = 'https://drive.google.com/file/d/untrusted_original/view'; },
    manifest => { manifest.materialImport.materials[0].documentId = 'missing_original'; },
    manifest => { manifest.materialImport.materials[1].documentId = manifest.materialImport.materials[0].documentId; },
    manifest => { manifest.materialImport.materials[1].item.id = manifest.materialImport.materials[0].item.id; },
    manifest => { manifest.documents[0].sha256 = '0'.repeat(64); },
  ];
  for (const mutate of mutations) await assert.rejects(readMaterialImportFile(await archive(undefined, mutate)));
  noWrites(state);
});

test('approved originals become Drive links only, preserving all careers, evidence and workspace links', async () => {
  const state = runtime(), before = await readFreeSnapshot(), input = await prepared();
  const result = await apply(input);
  assert.deepEqual(result, { added: 2, duplicates: 0, skipped: 0 });
  assert.equal(state.uploads.length, 2);
  assert.ok(state.uploads.every(upload => upload.kind === 'document'));
  assert.deepEqual(state.uploads[0].bytes, input.documents[0].bytes);
  const after = await readFreeSnapshot();
  assert.deepEqual(after.careers, before.careers);
  assert.deepEqual(after.documents, before.documents);
  assert.deepEqual(after.rawCareers, before.rawCareers);
  assert.deepEqual(after.rawDocuments, before.rawDocuments);
  assert.deepEqual(after.workspace.items.slice(0, 2), before.workspace.items);
  assert.deepEqual(after.workspace.links, before.workspace.links);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(state.rows.get(rootPath).preservedRootField, true);
  const added = after.workspace.items.filter(item => ['one', 'two'].includes(item.id));
  assert.equal(added.length, 2);
  assert.equal(added[0].fileUrl, 'https://drive.google.com/file/d/new_drive_original_0/view');
  assert.ok(added.every(item => item.purpose === 'classroom' && !Object.hasOwn(item, 'bytes') && !Object.hasOwn(item, 'documentId')));
});

test('explicit selection imports only selected materials and empty selection is a no-op', async () => {
  const input = await prepared();
  let state = runtime();
  assert.deepEqual(await apply(input, { approvedMaterialIds: [] }), { added: 0, duplicates: 0, skipped: 2 });
  noWrites(state); assert.equal(state.reads, 0);
  state = runtime();
  assert.deepEqual(await apply(input, { approvedMaterialIds: ['two'] }), { added: 1, duplicates: 0, skipped: 1 });
  assert.deepEqual(state.uploads.map(upload => upload.name), ['original_two.txt']);
  assert.ok(!(await readFreeSnapshot()).workspace.items.some(item => item.id === 'one'));
});

test('repeat imports do not reupload or overwrite owner edits and do not bump revision', async () => {
  const state = runtime(), input = await prepared();
  await apply(input);
  const pointer = state.rows.get(pointerPath);
  const itemPath = `${rootPath}/versions/${pointer.activeVersion}/documents/__workspace_item_one`;
  state.rows.get(itemPath).item = { ...state.rows.get(itemPath).item, title: 'Owner revision', tags: ['keep'], purpose: 'lecture', fileUrl: 'https://drive.google.com/file/d/owner_updated_link/view' };
  const before = await readFreeSnapshot(), previousWrites = state.batches.length;
  assert.deepEqual(await apply(input), { added: 0, duplicates: 2, skipped: 0 });
  assert.deepEqual(await readFreeSnapshot(), before);
  assert.equal(state.uploads.length, 2); assert.equal(state.batches.length, previousWrites);
});

test('same ID owned by another record kind fails before uploads', async () => {
  const state = runtime([normalizeWorkspaceItem({ id: 'one', kind: 'idea', title: 'Existing idea' })]);
  await assert.rejects(apply(await prepared()), /다른 종류/);
  noWrites(state);
});

test('workspace capacity is checked before any originals are uploaded', async () => {
  const state = runtime(Array.from({ length: 4998 }, (_, index) => normalizeWorkspaceItem({
    id: `existing_idea_${index}`, kind: 'idea', title: `Existing ${index}`, createdAt: stamp, updatedAt: stamp,
  })));
  await assert.rejects(apply(await prepared()), /개수가 제한/);
  noWrites(state);
});

test('tampered prepared bytes, mappings or approval IDs fail before writes', async () => {
  const mutations = [
    input => { input.documents[0].bytes[0] ^= 1; },
    input => { input.documents[1].sha256 = input.documents[0].sha256; },
    input => { input.documents[0].recordIds = ['career_one']; },
    input => { input.materials[0].item.kind = 'project'; },
    input => { input.materials[0].item.purpose = 'lecture'; },
    input => { input.materials[0].documentId = 'missing'; },
  ];
  for (const mutate of mutations) {
    const state = runtime(), input = await prepared(); mutate(input);
    await assert.rejects(apply(input)); noWrites(state);
  }
  for (const ids of [undefined, ['one', 'one'], ['missing'], [42]]) {
    const state = runtime(); await assert.rejects(apply(await prepared(), { approvedMaterialIds: ids })); noWrites(state);
  }
});

test('preview mutation after validation starts cannot alter saved fields or uploaded bytes', async () => {
  const state = runtime(), input = await prepared(), firstBytes = new Uint8Array(input.documents[0].bytes), secondBytes = new Uint8Array(input.documents[1].bytes);
  state.onValidate = () => {
    input.documents[0].bytes.fill(0); input.documents[1].bytes.fill(0);
    input.materials[0].item.title = 'Unreviewed mutation'; input.materials[1].item.tags.push('Unreviewed mutation');
  };
  await apply(input);
  assert.deepEqual(state.uploads[0].bytes, firstBytes); assert.deepEqual(state.uploads[1].bytes, secondBytes);
  const saved = (await readFreeSnapshot()).workspace.items.find(item => item.id === 'one');
  assert.equal(saved.title, 'Synthetic one');
  assert.deepEqual((await readFreeSnapshot()).workspace.items.find(item => item.id === 'two').tags, ['synthetic']);
});

test('cancellation before and after uploading keeps the visible archive unchanged', async () => {
  const input = await prepared();
  let state = runtime(), controller = new AbortController(); controller.abort();
  await assert.rejects(apply(input, { signal: controller.signal }), { name: 'AbortError' }); noWrites(state);
  state = runtime(); controller = new AbortController(); const before = await readFreeSnapshot();
  state.onUpload = () => controller.abort();
  await assert.rejects(apply(input, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(state.trashed, ['new_drive_original_0']);
  assert.deepEqual(await readFreeSnapshot(), before);
});

test('partial upload and precommit staging failures trash only newly uploaded originals', async () => {
  for (const mode of ['upload', 'stage']) {
    const state = runtime(), before = await readFreeSnapshot();
    if (mode === 'upload') state.failUploadAt = 1; else state.failBatch = true;
    await assert.rejects(apply(await prepared()));
    assert.deepEqual(state.trashed, mode === 'upload' ? ['new_drive_original_0'] : ['new_drive_original_0', 'new_drive_original_1']);
    assert.deepEqual(await readFreeSnapshot(), before);
  }
});

test('a concurrent edit rejects stale commit and leaves that edit and existing originals intact', async () => {
  const state = runtime();
  state.beforeTransaction = () => {
    state.rows.get(rootPath).revision++;
    state.rows.get(`${rootPath}/versions/live_version/careers/old_career`).title = 'Concurrent owner edit';
  };
  await assert.rejects(apply(await prepared()), { name: 'ArchiveRevisionConflictError' });
  assert.deepEqual(state.trashed, ['new_drive_original_0', 'new_drive_original_1']);
  const visible = await readFreeSnapshot();
  assert.equal(visible.careers[0].title, 'Concurrent owner edit');
  assert.equal(visible.workspace.items.length, 2);
  assert.equal(visible.documents[0].driveFileId, 'existing_drive_original');
});

test('a lost commit response retains originals because saved links may already be visible', async () => {
  const state = runtime(); state.uncertainCommit = true;
  await assert.rejects(apply(await prepared()), /commit response/);
  assert.deepEqual(state.trashed, []);
  const visible = await readFreeSnapshot();
  assert.equal(visible.workspace.items.filter(item => ['one', 'two'].includes(item.id)).length, 2);
  state.uncertainCommit = false;
  assert.deepEqual(await apply(await prepared()), { added: 0, duplicates: 2, skipped: 0 });
  assert.equal(state.uploads.length, 2);
});

test('a transaction retry after a possible commit never trashes possibly referenced originals', async () => {
  const state = runtime();
  state.afterFirstAttempt = writes => {
    for (const [path, value] of writes) state.rows.set(path, value);
    state.rows.get(rootPath).revision++;
  };
  await assert.rejects(apply(await prepared()));
  assert.deepEqual(state.trashed, []);
  assert.equal((await readFreeSnapshot()).workspace.items.length, 4);
});
