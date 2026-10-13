import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { normalizeWorkspace, normalizeWorkspaceItem, workspaceToRows } from '../shared/workspace.mjs';
import { FreeRestRepository } from '../server/free/repository.mjs';
import { serializeDriveSnapshot, createAutomaticSnapshot } from '../server/free/snapshot.mjs';

const runtimeKey = '__workspaceFreeFixture';
const virtualFirestore = `
const state = () => globalThis.${runtimeKey};
export const getFirestore = () => ({});
export const doc = (parent, ...parts) => ({ path: [parent.path, ...parts].filter(Boolean).join('/') });
export const collection = doc;
const row = reference => ({ id: reference.path.split('/').at(-1), data: () => structuredClone(state().rows.get(reference.path)) });
export async function getDocFromServer(reference) { return row(reference); }
export async function getDocsFromServer(reference) {
  await state().beforeCollectionRead?.(reference);
  const prefix = reference.path + '/';
  return { docs: [...state().rows.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).map(path => row({ path })) };
}
export function writeBatch() {
  const writes = [];
  return {
    set(reference, value) { writes.push([reference.path, structuredClone(value)]); },
    delete(reference) { writes.push([reference.path, undefined]); },
    async commit() {
      const current = state(); current.batches.push(writes);
      if (current.failBatchAt === current.batches.length - 1) throw new Error('simulated staging failure');
      if (current.failCleanup && writes.every(([, value]) => value === undefined)) throw new Error('simulated inactive cleanup failure');
      for (const [path, value] of writes) value === undefined ? current.rows.delete(path) : current.rows.set(path, value);
      await current.onBatchCommit?.(writes);
    },
  };
}
export async function runTransaction(database, callback) {
  const current = state(), writes = [];
  await current.beforeTransaction?.();
  const result = await callback({
    async get(reference) { return row(reference); },
    set(reference, value, options) { writes.push([reference.path, options?.merge ? { ...current.rows.get(reference.path), ...structuredClone(value) } : structuredClone(value)]); },
    delete(reference) { writes.push([reference.path, undefined]); },
  });
  (current.transactionAttempts ||= []).push(writes);
  if (current.failCleanup && writes.length && writes.every(([, value]) => value === undefined)) throw new Error('simulated inactive cleanup failure');
  for (const [path, value] of writes) value === undefined ? current.rows.delete(path) : current.rows.set(path, value);
  current.transactions.push(writes);
  return result;
}
`;
const virtualCloud = `
export const getFirebaseApp = () => ({});
export async function readyCloudUser() { return { uid: 'workspace_owner', email: 'synthetic@example.com', emailVerified: true, providerData: [{ providerId: 'google.com' }] }; }
`;
const virtualDrive = `
const state = () => globalThis.${runtimeKey};
export async function sha256(bytes) {
  const source = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', source)), x => x.toString(16).padStart(2, '0')).join('');
}
export async function validateDriveUploadFile(file) {
  if (!file.name.endsWith('.txt')) throw new Error('unsupported synthetic original');
  return 'text/plain';
}
export async function uploadDriveFile(file, kind, digest) {
  const current = state(), id = 'new_drive_original_' + current.uploads.length;
  const bytes = new Uint8Array(await file.arrayBuffer());
  current.uploads.push({ id, name: file.name, kind, digest, bytes });
  current.originals.set(id, bytes);
  return { id, name: file.name, mimeType: file.type, sha256: digest };
}
export async function downloadDriveFile(id, expected) {
  const current = state(), bytes = current.originals.get(id);
  current.downloads.push(id);
  (current.downloadChecks ||= []).push({ id, expected: structuredClone(expected) });
  if (current.unownedOriginals?.has(id) || !bytes || expected?.size !== undefined && bytes.length !== expected.size || expected?.sha256 && await sha256(bytes) !== expected.sha256) throw new Error('invalid synthetic original');
  return { blob: new Blob([bytes]), name: 'synthetic.txt' };
}
export async function trashDriveFile(id) { state().trashed.push(id); state().originals.delete(id); }
`;
const bundle = await build({
  absWorkingDir: new URL('..', import.meta.url).pathname,
  stdin: { contents: `export * from './src/free/store'; export * from './src/free/backup'; export * from './src/free/evidence-import'; export * from './src/free/normalize'; export { freeApi } from './src/free/api';`, resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{ name: 'workspace-isolated-runtime', setup(builder) {
    builder.onResolve({ filter: /^(firebase\/firestore|\.\.\/cloud|\.\/drive|\.\.\/api)$/ }, args => ({ path: args.path, namespace: 'workspace-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'workspace-fixture' }, args => ({ contents: args.path === 'firebase/firestore' ? virtualFirestore : args.path === '../cloud' ? virtualCloud : args.path === './drive' ? virtualDrive : `export async function api() { throw new Error('Unexpected real API request'); }`, loader: 'js' }));
  } }],
});
const directory = await mkdtemp(join(tmpdir(), 'workspace-browser-fixture-'));
const bundlePath = join(directory, 'runtime.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].contents);
const {
  normalizeCareer, normalizeDocumentRecord, readFreeSnapshot, readFreeData, readFreeWorkspace,
  mutateFreeWorkspace, importFreeWorkspace, exportFreeWorkspace, activateRestoredData,
  deleteFreeCareer, updateFreeCareer,
  validateFreeSnapshotBudget, createBackupBlob, readBackupFile, readDriveSnapshotFile,
  applyEvidenceImport, freeApi,
} = await import(pathToFileURL(bundlePath).href);
test.after(async () => { delete globalThis[runtimeKey]; await rm(directory, { recursive: true, force: true }); });

const rootPath = 'careerArchives/workspace_owner';
const legacyVersion = '01234567-89ab-4cde-8f01-23456789abcd';
const pointerPath = `${rootPath}/versions/workspace_v1/documents/__workspace_pointer_v1`;
const content = new TextEncoder().encode('synthetic original bytes');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = '2026-10-01T00:00:00.000Z';
const item = (id, kind = 'idea', fields = {}) => normalizeWorkspaceItem({ id, kind, title: `Item ${id}`, tags: ['synthetic'], createdAt: stamp, updatedAt: stamp, ...fields });
const career = (id = 'existing_career', fields = {}) => normalizeCareer({ id, title: 'Current edited career', documentIds: ['existing_document'], description: 'preserved description', tags: ['user tag'], ...fields });
const document = (fields = {}) => normalizeDocumentRecord({ id: 'existing_document', name: 'original.txt', size: content.length, mime: 'text/plain', createdAt: stamp, text: 'user approved extraction', driveFileId: 'existing_drive_original', sha256: hash(content), ...fields });
function fixture() {
  const rows = new Map([
    [rootPath, { activeVersion: legacyVersion, revision: 12, retainedOwnerField: 'unchanged' }],
    [`${rootPath}/versions/${legacyVersion}/careers/existing_career`, { ...career(), legacyCareerField: { untouched: true } }],
    [`${rootPath}/versions/${legacyVersion}/documents/existing_document`, { ...document(), legacyDocumentField: 'untouched' }],
  ]);
  const state = { rows, batches: [], transactions: [], uploads: [], downloads: [], trashed: [], originals: new Map([['existing_drive_original', new Uint8Array(content)]]) };
  globalThis[runtimeKey] = state;
  return state;
}
const legacyRows = state => [...state.rows].filter(([path]) => path.startsWith(`${rootPath}/versions/${legacyVersion}/`));
function seedWorkspace(state, items, links = [], version = 'workspace_seed') {
  const careerIds = legacyRows(state).filter(([path]) => path.includes('/careers/')).map(([path, row]) => row.id ?? path.split('/').at(-1));
  const workspace = normalizeWorkspace({ schemaVersion: 1, items, links, revision: state.rows.get(rootPath).revision }, { careerIds });
  state.rows.set(pointerPath, { id: '__workspace_pointer_v1', rowKind: 'introduce-me-workspace', schemaVersion: 1, activeVersion: version });
  for (const row of workspaceToRows(workspace)) state.rows.set(`${rootPath}/versions/${version}/documents/${row.id}`, row);
  return workspace;
}
const body = (fields = {}) => ({ item: { kind: 'idea', title: 'New graduate idea', body: 'Research question' }, links: ['career:existing_career'], expectedRevision: 12, ...fields });
const archive = (careers = [], workspace = { schemaVersion: 1, items: [], links: [] }, documents = []) => ({ format: 'introduce-me-workspace', version: 1, createdAt: stamp, careers, documents, workspace });
const file = (blob, name = 'backup.zip') => new File([blob], name, { type: name.endsWith('.json') ? 'application/json' : 'application/zip' });
const assertOriginalUnchanged = state => { assert.deepEqual(state.originals.get('existing_drive_original'), content); assert.deepEqual(state.trashed, []); };

test('reading a legacy archive yields an empty workspace without changing any stored rows', async () => {
  const state = fixture(), before = structuredClone([...state.rows]);
  assert.deepEqual(await readFreeWorkspace(), { schemaVersion: 1, items: [], links: [], revision: 12 });
  const data = await readFreeData();
  assert.equal(data.careers.length, 1); assert.equal(data.documents.length, 1);
  assert.deepEqual([...state.rows], before);
  assert.equal(state.batches.length, 0); assert.equal(state.transactions.length, 0);
});

test('workspace create and update preserve the legacy active version and career/document rows byte for byte', async () => {
  const state = fixture(), originalRows = structuredClone(legacyRows(state)), root = structuredClone(state.rows.get(rootPath));
  let saved = await mutateFreeWorkspace('create', body());
  const created = saved.items[0];
  assert.ok(created.id); assert.equal(saved.revision, 13);
  assert.deepEqual(state.rows.get(rootPath), { ...root, revision: 13 });
  assert.match(state.rows.get(pointerPath).activeVersion, /^workspace_/);
  const initialWorkspacePointer = structuredClone(state.rows.get(pointerPath));
  const initialBatchCount = state.batches.length;
  assert.ok(state.batches.flat().every(([path]) => path.includes('/versions/workspace_') && path.includes('/documents/__workspace_')));
  saved = await mutateFreeWorkspace('update', body({ item: { ...created, title: 'Updated idea' }, expectedRevision: 13 }), created.id);
  assert.equal(saved.items[0].title, 'Updated idea'); assert.equal(saved.revision, 14);
  assert.deepEqual(state.rows.get(pointerPath), initialWorkspacePointer, 'a small update reuses the current workspace namespace');
  assert.equal(state.batches.length, initialBatchCount, 'a small update uses a guarded transaction without staging a new namespace');
  assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion);
  assert.deepEqual(legacyRows(state), originalRows);
  assertOriginalUnchanged(state);
  const data = await readFreeData();
  assert.equal(data.documents.length, 1); assert.equal(data.documents[0].id, 'existing_document');
});

test('stale workspace revisions and malformed links reject before staging writes', async () => {
  for (const request of [body({ expectedRevision: 11 }), body({ links: ['career:missing_career'] })]) {
    const state = fixture(), before = structuredClone([...state.rows]);
    await assert.rejects(mutateFreeWorkspace('create', request));
    assert.deepEqual([...state.rows], before);
    assert.equal(state.batches.length, 0); assert.equal(state.transactions.length, 0);
  }
});

test('workspace staging failure preserves the published root and pointer', async () => {
  const state = fixture();
  const root = structuredClone(state.rows.get(rootPath)), pointer = structuredClone(state.rows.get(pointerPath));
  state.failBatchAt = 0;
  await assert.rejects(mutateFreeWorkspace('create', body()), /staging failure/);
  assert.deepEqual(state.rows.get(rootPath), root); assert.deepEqual(state.rows.get(pointerPath), pointer);
  assert.deepEqual((await readFreeWorkspace()).items, []);
  assert.ok(state.transactions.every(writes => writes.every(([, value]) => value === undefined)), 'only inactive staging cleanup may commit after a failed publication');
  assertOriginalUnchanged(state);
});

test('a concurrent root edit before the workspace transaction fails its CAS without replacing live edits', async () => {
  const state = fixture();
  const retained = seedWorkspace(state, [item('retained')]);
  const pointer = structuredClone(state.rows.get(pointerPath));
  state.beforeTransaction = async () => {
    state.rows.get(rootPath).revision = 13;
    state.rows.get(`${rootPath}/versions/${legacyVersion}/careers/existing_career`).description = 'concurrent user change';
  };
  await assert.rejects(mutateFreeWorkspace('create', body()), { status: 409 });
  assert.deepEqual(state.rows.get(pointerPath), pointer); assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion);
  assert.equal(state.transactions.length, 0);
  const live = await readFreeSnapshot();
  assert.deepEqual(live.workspace.items, retained.items);
  assert.equal(live.careers[0].description, 'concurrent user change'); assertOriginalUnchanged(state);
});

test('editing one item in a 500-item workspace writes only its changed metadata and root revision', async () => {
  const state = fixture();
  const seeded = seedWorkspace(state, Array.from({ length: 500 }, (_, index) => item(`idea_${index}`)));
  const originalRows = structuredClone(legacyRows(state));
  const pointer = structuredClone(state.rows.get(pointerPath));
  const beforePaths = [...state.rows.keys()];
  const target = seeded.items[249];
  const saved = await mutateFreeWorkspace('update', body({ item: { ...target, title: 'Edited only one item' }, links: [], expectedRevision: 12 }), target.id);
  assert.equal(state.batches.length, 0, 'the full workspace must not be rewritten for a single edit');
  assert.equal(state.transactions.length, 1);
  assert.ok(state.transactions[0].length <= 5, `a single edit wrote ${state.transactions[0].length} rows`);
  assert.ok(state.transactions[0].some(([path]) => path.endsWith(`/__workspace_item_${target.id}`)));
  assert.deepEqual(state.rows.get(pointerPath), pointer);
  assert.deepEqual([...state.rows.keys()], beforePaths);
  assert.equal(saved.items.find(entry => entry.id === target.id).title, 'Edited only one item');
  assert.deepEqual(saved.items.filter(entry => entry.id !== target.id), seeded.items.filter(entry => entry.id !== target.id));
  assert.deepEqual(legacyRows(state), originalRows); assertOriginalUnchanged(state);
});

test('deleting a heavily referenced course stages a large diff without rewriting legacy careers or originals', async () => {
  const state = fixture();
  const course = item('course_one', 'course');
  const assignments = Array.from({ length: 450 }, (_, index) => item(`assignment_${index}`, 'assignment', { courseId: course.id }));
  seedWorkspace(state, [course, ...assignments]);
  const originalRows = structuredClone(legacyRows(state));
  const saved = await mutateFreeWorkspace('delete', { expectedRevision: 12 }, course.id);
  assert.ok(state.batches.length >= 2, 'a diff above the guarded transaction limit must stage bounded batches');
  assert.ok(state.batches.every(batch => batch.length <= 400));
  assert.equal(saved.items.length, assignments.length);
  assert.ok(saved.items.every(entry => entry.courseId === ''));
  assert.deepEqual(legacyRows(state), originalRows);
  assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion);
  assertOriginalUnchanged(state);
});

test('a partial large workspace staging failure leaves the published namespace and root active', async () => {
  const state = fixture();
  const course = item('course_one', 'course');
  const seeded = seedWorkspace(state, [course, ...Array.from({ length: 450 }, (_, index) => item(`assignment_${index}`, 'assignment', { courseId: course.id }))]);
  const root = structuredClone(state.rows.get(rootPath)), pointer = structuredClone(state.rows.get(pointerPath));
  state.failBatchAt = 1;
  await assert.rejects(mutateFreeWorkspace('delete', { expectedRevision: 12 }, course.id), /staging failure/);
  assert.deepEqual(state.rows.get(rootPath), root); assert.deepEqual(state.rows.get(pointerPath), pointer);
  assert.deepEqual(await readFreeWorkspace(), seeded);
  assert.ok(state.transactions.every(writes => writes.every(([, value]) => value === undefined)), 'cleanup may remove only the inactive partially staged namespace');
  assertOriginalUnchanged(state);
});

test('inactive workspace cleanup failure does not undo a successful guarded publication', async () => {
  const state = fixture();
  const course = item('course_one', 'course');
  seedWorkspace(state, [course, ...Array.from({ length: 450 }, (_, index) => item(`assignment_${index}`, 'assignment', { courseId: course.id }))], [], 'workspace_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  state.failCleanup = true;
  const saved = await mutateFreeWorkspace('delete', { expectedRevision: 12 }, course.id);
  assert.equal(saved.items.length, 450);
  assert.ok(saved.items.every(entry => entry.courseId === ''));
  assert.ok(state.transactionAttempts.some(writes => writes.length && writes.every(([, value]) => value === undefined)), 'the test must exercise an attempted inactive namespace cleanup');
  assert.deepEqual(await readFreeWorkspace(), saved);
  assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion);
  assertOriginalUnchanged(state);
});

test('cleanup checks the current pointer inside its transaction and retains a concurrently republished namespace', async () => {
  const state = fixture();
  const course = item('course_one', 'course');
  const oldVersion = 'workspace_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const seeded = seedWorkspace(state, [course, ...Array.from({ length: 450 }, (_, index) => item(`assignment_${index}`, 'assignment', { courseId: course.id }))], [], oldVersion);
  const oldRows = structuredClone([...state.rows].filter(([path]) => path.includes(`/versions/${oldVersion}/`)));
  let attempts = 0;
  state.beforeTransaction = async () => {
    if (++attempts !== 2) return;
    state.rows.get(pointerPath).activeVersion = oldVersion;
    state.rows.get(rootPath).revision = 14;
  };
  await mutateFreeWorkspace('delete', { expectedRevision: 12 }, course.id);
  assert.ok(attempts >= 2, 'the cleanup transaction must be exercised after publication');
  assert.equal(state.rows.get(pointerPath).activeVersion, oldVersion);
  assert.deepEqual([...state.rows].filter(([path]) => path.includes(`/versions/${oldVersion}/`)), oldRows);
  const live = await readFreeWorkspace();
  assert.deepEqual(live.items, seeded.items); assert.equal(live.revision, 14);
  assertOriginalUnchanged(state);
});

test('workspace HTTP dispatch shares revision-guarded CRUD and course deletion keeps child records', async () => {
  const state = fixture();
  const call = async (path, method = 'GET', value) => {
    const response = await freeApi(path, { method, ...(value ? { body: JSON.stringify(value) } : {}) });
    assert.equal(response.handled, true); return response.value;
  };
  let workspace = await call('/workspace/items', 'POST', body({ item: { kind: 'course', title: 'Research methods' }, links: [] }));
  const courseId = workspace.items[0].id;
  workspace = await call('/workspace/items', 'POST', body({ item: { kind: 'assignment', title: 'Final essay', courseId }, links: [`course:${courseId}`], expectedRevision: workspace.revision }));
  workspace = await call('/workspace/items', 'POST', body({ item: { kind: 'paper', title: 'Related paper', courseIds: [courseId] }, links: [], expectedRevision: workspace.revision }));
  workspace = await call(`/workspace/items/${courseId}`, 'DELETE', { expectedRevision: workspace.revision });
  assert.equal(workspace.items.length, 2);
  assert.equal(workspace.items.find(item => item.kind === 'assignment').courseId, '');
  assert.deepEqual(workspace.items.find(item => item.kind === 'paper').courseIds, []);
  assert.deepEqual(workspace.links, []);
  assert.deepEqual(await call('/workspace'), workspace);
  assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion); assertOriginalUnchanged(state);
});

test('activation without a workspace payload retains items and prunes only missing career edges', async () => {
  const state = fixture();
  const retained = seedWorkspace(state, [item('idea_one'), item('project_one', 'project')], [
    { from: 'career:existing_career', to: 'idea:idea_one' }, { from: 'idea:idea_one', to: 'project:project_one' },
  ]);
  await activateRestoredData({ careers: [], documents: [document()] }, 12, legacyVersion);
  const live = await readFreeSnapshot();
  assert.deepEqual(live.workspace.items, retained.items);
  assert.deepEqual(live.workspace.links, [{ from: 'idea:idea_one', to: 'project:project_one' }]);
  assert.equal(live.workspace.revision, 13); assertOriginalUnchanged(state);
});

test('additive evidence import retains workspace items and links while adding originals to the career', async () => {
  const state = fixture();
  const retained = seedWorkspace(state, [item('idea_one')], [{ from: 'career:existing_career', to: 'idea:idea_one' }]);
  const bytes = new TextEncoder().encode('second synthetic original');
  const incoming = { id: 'incoming_document', name: 'incoming.txt', mime: 'text/plain', size: bytes.length, createdAt: stamp, recordIds: ['existing_career'], bytes, sha256: hash(bytes) };
  const result = await applyEvidenceImport({ format: 'career-evidence-import', version: 1, careers: [career()], documents: [incoming] }, { approvedLinks: { incoming_document: ['existing_career'] } });
  const live = await readFreeSnapshot();
  assert.equal(result.added, 1);
  assert.deepEqual(live.workspace.items, retained.items); assert.deepEqual(live.workspace.links, retained.links);
  assert.deepEqual(live.careers[0].documentIds, ['existing_document', 'incoming_document']);
  assertOriginalUnchanged(state);
});

test('legacy ZIP restoration preserves workspace items and detaches removed career edges', async () => {
  const state = fixture();
  const retained = seedWorkspace(state, [item('retained')], [{ from: 'career:existing_career', to: 'idea:retained' }]);
  const blob = await createBackupBlob({ careers: [], documents: [] });
  const parsed = await readBackupFile(file(blob)); assert.equal(parsed.workspace, undefined);
  const form = new FormData(); form.append('file', file(blob));
  const result = await freeApi('/backup/restore', { method: 'POST', body: form });
  assert.equal(result.value.ok, true);
  const live = await readFreeSnapshot();
  assert.deepEqual(live.workspace.items, retained.items); assert.deepEqual(live.workspace.links, []);
  assert.deepEqual(live.careers, []); assert.deepEqual(live.documents, []); assertOriginalUnchanged(state);
});

test('full ZIP includes workspace while a selected evidence ZIP omits it', async () => {
  const state = fixture(), retained = seedWorkspace(state, [item('retained')]);
  const full = await freeApi('/backup/export', {});
  const parsed = await readBackupFile(file(full.value.blob));
  assert.deepEqual(parsed.workspace.items, retained.items);
  assert.deepEqual(parsed.documents[0].bytes, content);
  const selected = await freeApi('/resume/evidence', { method: 'POST', body: JSON.stringify({ careerIds: ['existing_career'] }) });
  const selectedParsed = await readBackupFile(file(selected.value.blob));
  assert.equal(selectedParsed.workspace, undefined); assert.equal(selectedParsed.documents.length, 1);
  assert.deepEqual(state.uploads, []); assertOriginalUnchanged(state);
});

test('explicit workspace ZIP round-trips its payload and replaces it through ordinary restore', async () => {
  const state = fixture(); seedWorkspace(state, [item('replace_me')]);
  const expected = normalizeWorkspace({ schemaVersion: 1, items: [item('restored_project', 'project')], links: [{ from: 'career:existing_career', to: 'project:restored_project' }], revision: 0 }, { careerIds: ['existing_career'] });
  const blob = await createBackupBlob({ careers: [career()], documents: [{ ...document(), bytes: content }], workspace: expected });
  const parsed = await readBackupFile(file(blob)); assert.deepEqual(parsed.workspace, expected);
  const form = new FormData(); form.append('file', file(blob));
  await freeApi('/backup/restore', { method: 'POST', body: form });
  const live = await readFreeSnapshot();
  assert.deepEqual(live.workspace.items, expected.items); assert.deepEqual(live.workspace.links, expected.links);
  assert.equal(live.workspace.revision, 13); assert.equal(state.uploads.length, 1); assertOriginalUnchanged(state);
});

test('JSON import preserves current career/item edits, reports collisions, and cannot adopt foreign originals', async () => {
  const state = fixture(); seedWorkspace(state, [item('same_item', 'idea', { body: 'current user body' })]);
  const before = await readFreeSnapshot();
  const foreign = document({ id: 'foreign_document', name: 'foreign.txt', driveFileId: 'foreign_drive_original', sha256: 'a'.repeat(64) });
  const incoming = archive([
    career('existing_career', { title: 'stale imported title', description: 'stale description' }),
    career('new_career', { title: 'new career', documentIds: [foreign.id] }),
  ], { schemaVersion: 1, items: [item('same_item', 'idea', { body: 'stale imported body' }), item('new_item')], links: [{ from: 'career:new_career', to: 'idea:new_item' }] }, [foreign]);
  const result = await importFreeWorkspace({ archive: incoming, expectedRevision: 12 });
  const live = await readFreeSnapshot();
  assert.deepEqual(live.careers.find(item => item.id === 'existing_career'), before.careers[0]);
  assert.deepEqual(live.workspace.items.find(item => item.id === 'same_item'), before.workspace.items[0]);
  assert.equal(live.careers.find(item => item.id === 'new_career'), undefined);
  assert.deepEqual(live.workspace.links, [], 'links to a skipped foreign-original career cannot survive the merge');
  assert.deepEqual(live.documents, before.documents);
  assert.equal(result.added.careers, 0); assert.equal(result.added.items, 1); assert.equal(result.added.documents, 0);
  for (const ref of ['career:existing_career', 'career:new_career', 'document:foreign_document', 'idea:same_item']) assert.ok(result.conflicts.some(conflict => conflict.ref === ref));
  assert.deepEqual(state.uploads, []); assert.deepEqual(state.downloads, []); assertOriginalUnchanged(state);
});

test('workspace-only JSON import preserves unknown legacy fields and the active career UUID', async () => {
  const state = fixture(), originalRows = structuredClone(legacyRows(state));
  const incoming = archive([], { schemaVersion: 1, items: [item('imported_idea')], links: [{ from: 'career:existing_career', to: 'idea:imported_idea' }] });
  const result = await importFreeWorkspace({ archive: incoming, expectedRevision: 12 });
  assert.equal(result.added.items, 1); assert.equal(result.added.careers, 0); assert.equal(result.added.documents, 0);
  assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion); assert.equal(state.rows.get(rootPath).revision, 13);
  assert.deepEqual(legacyRows(state), originalRows);
  const live = await readFreeWorkspace();
  assert.equal(live.items[0].id, 'imported_idea'); assert.equal(live.links.length, 1);
  assert.equal(state.uploads.length, 0); assert.equal(state.downloads.length, 0); assertOriginalUnchanged(state);
});

test('JSON recovery through the free API rebuilds an empty Firestore archive from verified private Drive originals', async () => {
  const state = fixture(); state.rows.clear();
  const recoveredWorkspace = { schemaVersion: 1, items: [item('recovered_idea')], links: [{ from: 'career:existing_career', to: 'idea:recovered_idea' }] };
  const recovery = archive([career()], recoveredWorkspace, [document()]);
  const response = await freeApi('/workspace/import', { method: 'POST', body: JSON.stringify({ archive: recovery, expectedRevision: 0 }) });
  assert.equal(response.handled, true);
  assert.deepEqual(response.value.added, { careers: 1, documents: 1, items: 1, links: 1 });
  assert.deepEqual(response.value.conflicts, []);
  assert.deepEqual(state.downloadChecks, [{ id: 'existing_drive_original', expected: { kind: 'document', size: content.length, sha256: hash(content) } }]);
  const live = await readFreeSnapshot();
  assert.equal(live.revision, 1); assert.equal(live.careers.length, 1); assert.equal(live.documents.length, 1);
  assert.deepEqual(live.careers[0], career());
  assert.equal(live.documents[0].driveFileId, 'existing_drive_original');
  assert.deepEqual(live.documents[0].recordIds, ['existing_career']);
  assert.deepEqual(live.workspace.items, recoveredWorkspace.items);
  assert.deepEqual(live.workspace.links, [{ from: 'career:existing_career', to: 'idea:recovered_idea' }]);
  assert.deepEqual(state.uploads, []); assertOriginalUnchanged(state);
});

test('JSON API import reuses known document IDs and SHA duplicates without downloading or replacing their originals', async () => {
  const state = fixture(), before = structuredClone([...state.rows]);
  const sameId = document({ name: 'stale_imported_name.txt', driveFileId: 'foreign_drive_reference' });
  const first = await freeApi('/workspace/import', { method: 'POST', body: JSON.stringify({ archive: archive([career()], { schemaVersion: 1, items: [], links: [] }, [sameId]), expectedRevision: 12 }) });
  assert.equal(first.value.added.documents, 0); assert.deepEqual(state.downloads, []);
  assert.deepEqual([...state.rows], before);
  assert.ok(first.value.conflicts.some(conflict => conflict.ref === 'document:existing_document'));
  const alias = document({ id: 'known_sha_alias', name: 'alias.txt', driveFileId: 'another_foreign_reference' });
  const second = await freeApi('/workspace/import', { method: 'POST', body: JSON.stringify({ archive: archive([career('alias_career', { documentIds: [alias.id] })], { schemaVersion: 1, items: [], links: [] }, [alias]), expectedRevision: 12 }) });
  assert.equal(second.value.added.documents, 0); assert.equal(second.value.added.careers, 1);
  assert.deepEqual(state.downloads, []); assert.equal(state.uploads.length, 0);
  const live = await readFreeSnapshot();
  assert.deepEqual(live.careers.find(item => item.id === 'alias_career').documentIds, ['existing_document']);
  assert.equal(live.documents[0].name, 'original.txt'); assert.equal(live.documents[0].driveFileId, 'existing_drive_original');
  assert.equal(live.documents.length, 1); assertOriginalUnchanged(state);
});

test('JSON API recovery rejects foreign-owner, wrong-size and wrong-SHA originals before any Firestore mutation', async () => {
  for (const scenario of ['foreign-owner', 'wrong-size', 'wrong-sha']) {
    const state = fixture(); state.rows.clear();
    const incoming = document();
    if (scenario === 'foreign-owner') state.unownedOriginals = new Set([incoming.driveFileId]);
    if (scenario === 'wrong-size') incoming.size++;
    if (scenario === 'wrong-sha') incoming.sha256 = 'f'.repeat(64);
    const recovery = archive([career()], { schemaVersion: 1, items: [item('must_not_publish')], links: [] }, [incoming]);
    await assert.rejects(freeApi('/workspace/import', { method: 'POST', body: JSON.stringify({ archive: recovery, expectedRevision: 0 }) }));
    assert.deepEqual(state.downloads, ['existing_drive_original']);
    assert.equal(state.rows.size, 0); assert.equal(state.batches.length, 0); assert.equal(state.transactions.length, 0);
    assert.equal(state.uploads.length, 0); assertOriginalUnchanged(state);
  }
});

test('JSON API recovery verifies all originals before writing even when a later file fails after an earlier success', async () => {
  const state = fixture(); state.rows.clear();
  const expected = new TextEncoder().encode('second expected bytes');
  const tampered = new TextEncoder().encode('second tampered bytes');
  assert.equal(expected.length, tampered.length);
  state.originals.set('second_drive_original', tampered);
  const second = document({ id: 'second_document', name: 'second.txt', size: expected.length, sha256: hash(expected), driveFileId: 'second_drive_original' });
  const recovery = archive([career('recovered_career', { documentIds: ['existing_document', second.id] })], { schemaVersion: 1, items: [item('must_not_publish')], links: [] }, [document(), second]);
  await assert.rejects(freeApi('/workspace/import', { method: 'POST', body: JSON.stringify({ archive: recovery, expectedRevision: 0 }) }));
  assert.deepEqual(state.downloads, ['existing_drive_original', 'second_drive_original']);
  assert.equal(state.rows.size, 0); assert.equal(state.batches.length, 0); assert.equal(state.transactions.length, 0);
  assert.equal(state.uploads.length, 0); assert.deepEqual(state.originals.get('second_drive_original'), tampered);
  assertOriginalUnchanged(state);
});

test('targeted career deletion removes only that career and its workspace edges while preserving other raw rows', async () => {
  const state = fixture();
  const survivorPath = `${rootPath}/versions/${legacyVersion}/careers/remaining_career`;
  state.rows.set(survivorPath, { ...career('remaining_career', { title: 'Retained career' }), arbitraryLegacyField: ['preserved', { value: 7 }] });
  const seeded = seedWorkspace(state, [item('related_idea'), item('retained_idea')], [
    { from: 'career:existing_career', to: 'idea:related_idea' },
    { from: 'career:remaining_career', to: 'idea:retained_idea' },
    { from: 'idea:related_idea', to: 'idea:retained_idea' },
  ]);
  const deletedPath = `${rootPath}/versions/${legacyVersion}/careers/existing_career`;
  const expectedRows = structuredClone(legacyRows(state).filter(([path]) => path !== deletedPath));
  const pointer = structuredClone(state.rows.get(pointerPath));
  await deleteFreeCareer('existing_career');
  assert.equal(state.rows.has(deletedPath), false); assert.deepEqual(legacyRows(state), expectedRows);
  assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion); assert.equal(state.rows.get(rootPath).revision, 13);
  assert.deepEqual(state.rows.get(pointerPath), pointer);
  assert.equal(state.batches.length, 0);
  const live = await readFreeSnapshot();
  assert.deepEqual(live.workspace.items, seeded.items);
  assert.deepEqual(live.workspace.links, seeded.links.filter(edge => edge.from !== 'career:existing_career' && edge.to !== 'career:existing_career'));
  assert.deepEqual(live.careers.map(career => career.id), ['remaining_career']);
  assert.equal(live.documents.length, 1); assertOriginalUnchanged(state);
});

function seedOversizeLegacyCareers(state) {
  for (let index = 0; index < 190; index++) {
    const record = career(`oversize_career_${index}`, { description: '경'.repeat(10000) });
    state.rows.set(`${rootPath}/versions/${legacyVersion}/careers/${record.id}`, { ...record, untouchedLegacyCounter: index });
  }
}

test('pure career deletion can reduce an already oversized archive while edits remain budget guarded', async () => {
  const state = fixture(); seedOversizeLegacyCareers(state);
  const retained = seedWorkspace(state, [item('retained_idea')], [{ from: 'career:existing_career', to: 'idea:retained_idea' }]);
  const before = await readFreeSnapshot();
  assert.throws(() => validateFreeSnapshotBudget(before.careers, before.documents, before.workspace), { status: 413 });
  await assert.rejects(updateFreeCareer('existing_career', { title: 'Must remain blocked by the budget' }), { status: 413 });
  const deletedPath = `${rootPath}/versions/${legacyVersion}/careers/existing_career`;
  const expectedRows = structuredClone(legacyRows(state).filter(([path]) => path !== deletedPath));
  await deleteFreeCareer('existing_career');
  const after = await readFreeSnapshot();
  assert.equal(after.careers.length, 190);
  assert.throws(() => validateFreeSnapshotBudget(after.careers, after.documents, after.workspace), { status: 413 }, 'one deletion should still leave this legacy archive oversized');
  assert.deepEqual(after.workspace.items, retained.items); assert.deepEqual(after.workspace.links, []);
  assert.deepEqual(legacyRows(state), expectedRows);
  assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion); assert.equal(state.rows.get(rootPath).revision, 13);
  assertOriginalUnchanged(state);
});

test('deleting an existing workspace item can reduce an oversized archive without relaxing edit limits', async () => {
  const state = fixture(); seedOversizeLegacyCareers(state);
  const seeded = seedWorkspace(state, [item('delete_me'), item('keep_me')], [{ from: 'career:existing_career', to: 'idea:delete_me' }]);
  const before = await readFreeSnapshot();
  assert.throws(() => validateFreeSnapshotBudget(before.careers, before.documents, before.workspace), { status: 413 });
  await assert.rejects(mutateFreeWorkspace('update', body({ item: { ...seeded.items[1], title: 'Must remain budget guarded' }, links: [] }), 'keep_me'), { status: 413 });
  const originalRows = structuredClone(legacyRows(state));
  const pointer = structuredClone(state.rows.get(pointerPath));
  const saved = await mutateFreeWorkspace('delete', { expectedRevision: 12 }, 'delete_me');
  assert.deepEqual(saved.items, seeded.items.filter(item => item.id === 'keep_me')); assert.deepEqual(saved.links, []);
  assert.equal(saved.revision, 13); assert.deepEqual(state.rows.get(pointerPath), pointer);
  assert.equal(state.rows.get(rootPath).activeVersion, legacyVersion);
  assert.deepEqual(legacyRows(state), originalRows);
  const after = await readFreeSnapshot();
  assert.throws(() => validateFreeSnapshotBudget(after.careers, after.documents, after.workspace), { status: 413 });
  assertOriginalUnchanged(state);
});

test('JSON SHA translation reuses current original metadata and repeated imports perform no writes', async () => {
  const state = fixture(); seedWorkspace(state, [item('retained')]);
  const duplicate = document({ id: 'imported_alias', name: 'wrong_name.txt', driveFileId: 'foreign_drive_reference' });
  const incoming = archive([career('new_career', { documentIds: ['imported_alias'] })], { schemaVersion: 1, items: [item('new_idea')], links: [] }, [duplicate]);
  const result = await importFreeWorkspace({ archive: incoming, expectedRevision: 12 });
  const live = await readFreeSnapshot();
  assert.deepEqual(live.careers.find(item => item.id === 'new_career').documentIds, ['existing_document']);
  assert.equal(live.documents.length, 1); assert.equal(live.documents[0].name, 'original.txt'); assert.equal(live.documents[0].driveFileId, 'existing_drive_original');
  const count = state.transactions.length;
  const repeated = await importFreeWorkspace({ archive: incoming, expectedRevision: result.workspace.revision });
  assert.equal(state.transactions.length, count); assert.equal(repeated.added.careers, 0); assert.equal(repeated.added.items, 0);
  assertOriginalUnchanged(state);
});

test('career-only legacy JSON preserves workspace and malformed workspace fails atomically', async () => {
  const state = fixture(), retained = seedWorkspace(state, [item('retained')]);
  await importFreeWorkspace({ archive: { careers: [career('new_career', { documentIds: [] })] }, expectedRevision: 12 });
  assert.deepEqual((await readFreeWorkspace()).items, retained.items);
  const before = structuredClone([...state.rows]);
  await assert.rejects(importFreeWorkspace({ archive: archive([], { schemaVersion: 1, items: [item('unsafe_material', 'material', { fileUrl: 'https://drive.google.com/file/d/example/view' })], links: [{ from: 'material:unsafe_material', to: 'career:missing' }] }), expectedRevision: 13 }));
  assert.deepEqual([...state.rows], before); assertOriginalUnchanged(state);
});

test('JSON import rejects local original paths and duplicate SHA aliases before staging anything', async () => {
  for (const documents of [
    [{ ...document(), storageName: '../private-original.txt' }],
    [{ ...document(), filePath: 'originals/existing_document.txt' }],
    [document(), document({ id: 'same_hash_alias' })],
  ]) {
    const state = fixture(), before = structuredClone([...state.rows]);
    await assert.rejects(importFreeWorkspace({ archive: archive([career()], { schemaVersion: 1, items: [item('must_not_publish')], links: [] }, documents), expectedRevision: 12 }));
    assert.deepEqual([...state.rows], before);
    assert.equal(state.batches.length, 0); assert.equal(state.transactions.length, 0);
    assert.equal(state.uploads.length, 0); assertOriginalUnchanged(state);
  }
});

test('metadata budget rejects combined records that cannot fit in the bounded automatic snapshot', () => {
  const careers = Array.from({ length: 190 }, (_, index) => career(`career_${index}`, { description: '경'.repeat(10000), documentIds: [] }));
  const workspace = normalizeWorkspace({ schemaVersion: 1, items: [item('small_idea')], links: [] });
  assert.throws(() => validateFreeSnapshotBudget(careers, [], workspace), { status: 413 });
  validateFreeSnapshotBudget([career()], [document()], workspace);
});

test('dense many-to-many metadata stays within actual compact JSON, ZIP and automatic-backup limits as a matrix', async () => {
  const limit = 5 * 1024 * 1024;
  const bodies = Array.from({ length: 100 }, (_, index) => new TextEncoder().encode(`synthetic dense document ${index}`));
  const documents = Array.from({ length: 100 }, (_, index) => document({
    id: `document_${String(index).padStart(28, '0')}`, name: `document_${index}.txt`,
    driveFileId: `dense_drive_${index}`, sha256: hash(bodies[index]), size: bodies[index].length,
  }));
  const documentIds = documents.map(entry => entry.id);
  const workspace = normalizeWorkspace({ schemaVersion: 1, items: [], links: [] });
  for (const count of [350, 550, 700]) {
    const careers = Array.from({ length: count }, (_, index) => career(`career_${String(index).padStart(30, '0')}`, { title: `Dense career ${index}`, description: '', tags: [], documentIds }));
    const inverse = documents.map(entry => ({ ...entry, recordIds: careers.map(career => career.id) }));
    const compactBytes = Buffer.byteLength(JSON.stringify(archive(careers, { schemaVersion: 1, items: [], links: [] }, inverse)));
    const zipManifest = { format: 'career-archive', version: 1, createdAt: stamp, careers, documents: inverse.map(entry => ({ ...entry, filePath: `originals/${entry.id}.txt` })), workspace };
    const zipBytes = Buffer.byteLength(JSON.stringify(zipManifest));
    const autoBytes = Buffer.byteLength(JSON.stringify({ format: 'career-drive-snapshot', version: 1, createdAt: stamp, careers, documents, workspace }, null, 2));
    assert.ok(autoBytes < limit, 'this regression must pass the old automatic-only budget');
    if (count < 700) {
      assert.ok(compactBytes < limit && zipBytes < limit);
      validateFreeSnapshotBudget(careers, documents, workspace);
      if (count === 550) {
        assert.ok(Buffer.byteLength(JSON.stringify(zipManifest, null, 2)) > limit, 'compact serialization should retain capacity previously consumed by formatting');
        const blob = await createBackupBlob({ careers, documents: documents.map((entry, index) => ({ ...entry, bytes: bodies[index] })), workspace });
        const restored = await readBackupFile(file(blob));
        assert.equal(restored.careers.length, count); assert.equal(restored.documents.length, 100);
        assert.equal(restored.documents[0].recordIds.length, count);
      }
    } else {
      assert.ok(zipBytes > limit, `the ${count}-career ZIP manifest must reproduce the inverse-link overflow`);
      assert.ok(compactBytes > limit, 'the dense matrix must also exceed compact JSON export capacity');
      assert.throws(() => validateFreeSnapshotBudget(careers, documents, workspace), { status: 413 });
      await assert.rejects(createBackupBlob({ careers, documents: documents.map((entry, index) => ({ ...entry, bytes: bodies[index] })), workspace }));
    }
  }
});

function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, firestoreValue(entry)])) } };
}
function restFetcher(state) {
  return async raw => {
    const url = new URL(raw), prefix = '/documents/';
    const path = url.pathname.slice(url.pathname.indexOf(prefix) + prefix.length);
    const encodeRow = (path, value) => ({ name: `projects/test-project/databases/(default)/documents/${path}`, fields: firestoreValue(value).mapValue.fields });
    if (url.searchParams.has('pageSize')) {
      const start = path + '/';
      const documents = [...state.rows].filter(([name]) => name.startsWith(start) && !name.slice(start.length).includes('/')).map(([name, value]) => encodeRow(name, value));
      return new Response(JSON.stringify({ documents }));
    }
    const value = state.rows.get(path);
    return value ? new Response(JSON.stringify(encodeRow(path, value))) : new Response(null, { status: 404 });
  };
}

test('REST automatic snapshots read the reserved pointer and round-trip workspace plus legacy path-derived IDs', async () => {
  const state = fixture(), retained = seedWorkspace(state, [item('retained')], [{ from: 'career:existing_career', to: 'idea:retained' }]);
  for (const [path, row] of legacyRows(state)) { const { id, ...oldRowWithoutId } = row; state.rows.set(path, oldRowWithoutId); }
  const fetcher = restFetcher(state);
  const repository = new FreeRestRepository({ projectId: 'test-project', uid: 'workspace_owner', idToken: 'synthetic-token', fetcher });
  const snapshot = await repository.snapshot();
  assert.equal(snapshot.activeVersion, legacyVersion); assert.equal(snapshot.careers[0].id, 'existing_career'); assert.equal(snapshot.documents[0].id, 'existing_document');
  assert.deepEqual(snapshot.workspace.items, retained.items);
  const capture = createAutomaticSnapshot({ config: { projectId: 'test-project' }, fetcher });
  const buffer = await capture('workspace_owner', { idToken: 'synthetic-token' });
  const decoded = await readDriveSnapshotFile(file(buffer, 'automatic.json'));
  assert.deepEqual(decoded.workspace.items, retained.items); assert.deepEqual(decoded.workspace.links, retained.links);
  assert.equal(decoded.documents[0].driveFileId, 'existing_drive_original'); assert.equal(decoded.documents[0].sha256, hash(content));
  const serialized = JSON.parse(serializeDriveSnapshot(snapshot));
  assert.equal(serialized.workspace.schemaVersion, 1); assert.equal(serialized.documents.length, 1);
  assert.equal(state.uploads.length, 0); assert.equal(state.downloads.length, 0); assertOriginalUnchanged(state);
});

test('snapshot readers retry an old namespace cleaned during publication while still rejecting a stable missing namespace', async () => {
  for (const reader of ['browser', 'rest']) {
    const state = fixture();
    const oldVersion = 'workspace_before';
    const newVersion = 'workspace_after';
    seedWorkspace(state, [item('old_idea')], [], oldVersion);
    const expected = normalizeWorkspace({ schemaVersion: 1, items: [item('new_idea')], links: [], revision: 13 }, { careerIds: ['existing_career'] });
    for (const row of workspaceToRows(expected)) state.rows.set(`${rootPath}/versions/${newVersion}/documents/${row.id}`, row);
    let switched = false;
    const publishAndClean = () => {
      if (switched) return;
      switched = true;
      state.rows.get(rootPath).revision = 13;
      state.rows.get(pointerPath).activeVersion = newVersion;
      for (const path of [...state.rows.keys()]) if (path.startsWith(`${rootPath}/versions/${oldVersion}/`)) state.rows.delete(path);
    };
    let snapshot;
    if (reader === 'browser') {
      state.beforeCollectionRead = async reference => {
        if (reference.path === `${rootPath}/versions/${oldVersion}/documents`) publishAndClean();
      };
      snapshot = await readFreeSnapshot();
    } else {
      const ordinaryFetcher = restFetcher(state);
      const fetcher = async (raw, options) => {
        const url = new URL(raw);
        if (url.pathname.endsWith(`/versions/${oldVersion}/documents`)) publishAndClean();
        return ordinaryFetcher(raw, options);
      };
      snapshot = await new FreeRestRepository({ projectId: 'test-project', uid: 'workspace_owner', idToken: 'synthetic-token', fetcher }).snapshot();
    }
    assert.equal(switched, true, `${reader} must exercise the pointer/list race`);
    assert.equal(snapshot.revision, 13); assert.deepEqual(snapshot.workspace.items, expected.items);
    assert.equal(state.batches.length, 0); assert.equal(state.transactions.length, 0); assertOriginalUnchanged(state);

    const missing = fixture();
    seedWorkspace(missing, [item('missing_idea')], [], oldVersion);
    for (const path of [...missing.rows.keys()]) if (path.startsWith(`${rootPath}/versions/${oldVersion}/`)) missing.rows.delete(path);
    const readMissing = reader === 'browser' ? readFreeSnapshot() : new FreeRestRepository({ projectId: 'test-project', uid: 'workspace_owner', idToken: 'synthetic-token', fetcher: restFetcher(missing) }).snapshot();
    await assert.rejects(readMissing, /누락/, 'a same-revision empty namespace is genuine missing data');
    assert.equal(missing.rows.get(rootPath).revision, 12);
    assert.equal(missing.batches.length, 0); assert.equal(missing.transactions.length, 0); assertOriginalUnchanged(missing);
  }
});

test('JSON export includes current workspace and original references without introducing file contents', async () => {
  const state = fixture(), retained = seedWorkspace(state, [item('retained')]);
  const exported = await exportFreeWorkspace();
  assert.equal(exported.format, 'introduce-me-workspace'); assert.equal(exported.version, 1);
  assert.deepEqual(exported.workspace.items, retained.items); assert.equal(Object.hasOwn(exported.workspace, 'revision'), false);
  assert.equal(exported.documents[0].driveFileId, 'existing_drive_original'); assert.equal(Object.hasOwn(exported.documents[0], 'bytes'), false);
  assert.equal(state.batches.length, 0); assert.equal(state.transactions.length, 0); assertOriginalUnchanged(state);
});
