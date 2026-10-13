import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';

const workingDirectory = new URL('..', import.meta.url).pathname;
const stateKey = '__careerEvidenceImportTest';
const mockedRuntime = `
const state = () => globalThis.${stateKey};
export class ArchiveRevisionConflictError extends Error {
  constructor() { super('archive changed before any root write'); this.name = 'ArchiveRevisionConflictError'; }
}
export async function readFreeSnapshot() {
  const current = state(); current.reads++;
  current.events.push('read');
  return structuredClone(current.snapshot);
}
export async function activateRestoredData(input, revision, activeVersion, options = {}) {
  const current = state();
  current.activations.push({ input: structuredClone(input), revision, activeVersion });
  current.events.push('stage');
  await current.onStage?.(input, options);
  if (options.signal?.aborted) throw options.signal.reason || new DOMException('Aborted', 'AbortError');
  if (current.failure === 'staging') throw new Error('staging failed');
  if (revision !== current.snapshot.revision || activeVersion !== current.snapshot.activeVersion)
    throw new Error('archive changed');
  options.onCommitStarted?.();
  current.events.push('commit');
  if (current.failure === 'definite-conflict') throw new ArchiveRevisionConflictError();
  if (current.failure === 'spoofed-conflict') throw Object.assign(new Error('uncertain lookalike error'), { name: 'ArchiveRevisionConflictError' });
  if (current.failure === 'uncertain') throw new Error('commit outcome unknown');
  current.snapshot = { ...structuredClone(input), revision: revision + 1, activeVersion: 'committed_version' };
}
export async function uploadDriveFile(file, kind, sha256) {
  const current = state();
  const index = current.uploads.length;
  current.events.push('upload');
  current.uploads.push({ name: file.name, kind, sha256, bytes: new Uint8Array(await file.arrayBuffer()) });
  await current.onUpload?.(file, index);
  if (current.failUploadAt === index) throw new Error('upload failed');
  return { id: 'owned_upload_' + index, name: file.name, mimeType: file.type, size: String(file.size), sha256 };
}
export async function trashDriveFile(id) {
  const current = state(); current.trashed.push(id); current.events.push('trash');
}
export async function validateDriveUploadFile(file) {
  if (!file.name.endsWith('.txt') || file.size > 25 * 1024 * 1024) throw new Error('invalid test original');
  return 'text/plain';
}
export async function sha256(bytes) {
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), x => x.toString(16).padStart(2, '0')).join('');
}
`;
const output = await build({
  entryPoints: ['src/free/evidence-import.ts'], absWorkingDir: workingDirectory,
  bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{
    name: 'isolated-evidence-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/(?:store|drive)$/ }, () => ({ path: 'runtime', namespace: 'evidence-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'evidence-test' }, () => ({ contents: mockedRuntime, loader: 'js' }));
    },
  }],
});
const normalizedOutput = await build({ entryPoints: ['src/free/normalize.ts'], absWorkingDir: workingDirectory, bundle: true, platform: 'browser', format: 'esm', write: false });
const backupOutput = await build({ entryPoints: ['src/free/backup.ts'], absWorkingDir: workingDirectory, bundle: true, platform: 'browser', format: 'esm', write: false });
const bundlesDirectory = await mkdtemp(join(tmpdir(), 'career-evidence-tests-'));
test.after(async () => { delete globalThis[stateKey]; await rm(bundlesDirectory, { recursive: true, force: true }); });
async function importBundle(name, contents) {
  const path = join(bundlesDirectory, `${name}.mjs`);
  await writeFile(path, contents);
  return import(pathToFileURL(path).href);
}
const { readEvidenceImportFile, readEvidenceImportReviewCareers, applyEvidenceImport: applyEvidenceImportRaw } = await importBundle('evidence-import', output.outputFiles[0].contents);
const { normalizeCareer, normalizeDocumentRecord } = await importBundle('normalize', normalizedOutput.outputFiles[0].contents);
const { readBackupFile } = await importBundle('backup', backupOutput.outputFiles[0].contents);
// Successful fixtures represent the user explicitly accepting every suggested link.
const applyEvidenceImport = (input, options = {}) => applyEvidenceImportRaw(input, {
  approvedLinks: Object.fromEntries(input.documents.map(document => [document.id, document.recordIds])),
  ...options,
});

const firestoreStateKey = '__careerEvidenceFirestoreTest';
const firestoreRuntime = `
const state = () => globalThis.${firestoreStateKey};
export const getFirestore = () => ({ testDatabase: true });
export const doc = (parent, ...parts) => ({ path: [parent.path, ...parts].filter(Boolean).join('/') });
export const collection = doc;
const row = reference => ({ id: reference.path.split('/').at(-1), data: () => structuredClone(state().rows.get(reference.path)) });
export async function getDocFromServer(reference) { return row(reference); }
export async function getDocsFromServer(reference) {
  const prefix = reference.path + '/';
  return { docs: [...state().rows.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).map(path => row({ path })) };
}
export function writeBatch() {
  const writes = [];
  return {
    set(reference, value) { writes.push([reference.path, structuredClone(value)]); },
    async commit() {
      const current = state(); current.events.push('batch-commit'); current.batches.push(writes);
      for (const [path, value] of writes) current.rows.set(path, value);
      await current.onBatchCommit?.(writes);
    },
  };
}
export async function runTransaction(database, callback) {
  const current = state(); current.events.push('transaction-start');
  const attempt = async () => {
    const writes = [];
    const result = await callback({
      async get(reference) { current.events.push('transaction-read'); return row(reference); },
      set(reference, value, options) {
        current.events.push('transaction-root-write');
        writes.push([reference.path, options?.merge ? { ...current.rows.get(reference.path), ...structuredClone(value) } : structuredClone(value)]);
      },
      delete(reference) { writes.push([reference.path, undefined]); },
    });
    return { writes, result };
  };
  let pending = await attempt();
  if (current.retryAfterFirstAttempt) {
    await current.retryAfterFirstAttempt(pending.writes);
    pending = await attempt();
  }
  for (const [path, value] of pending.writes) value === undefined ? current.rows.delete(path) : current.rows.set(path, value);
  current.events.push('transaction-commit');
  return pending.result;
}
`;
const cloudRuntime = `
export function getFirebaseApp() { return { testApp: true }; }
export async function readyCloudUser() {
  return { uid: 'test_owner', email: 'synthetic@example.com', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
}
`;
const storeOutput = await build({
  entryPoints: ['src/free/store.ts'], absWorkingDir: workingDirectory,
  bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{
    name: 'isolated-firestore-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^(?:firebase\/firestore|\.\.\/cloud)$/ }, args => ({ path: args.path === 'firebase/firestore' ? 'firestore' : 'cloud', namespace: 'firestore-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'firestore-test' }, args => ({ contents: args.path === 'firestore' ? firestoreRuntime : cloudRuntime, loader: 'js' }));
    },
  }],
});
const { activateRestoredData: activateActualStore, readFreeSnapshot: readActualStore, ArchiveRevisionConflictError } = await importBundle('actual-store', storeOutput.outputFiles[0].contents);
test.after(() => { delete globalThis[firestoreStateKey]; });

const content = label => new TextEncoder().encode(`synthetic evidence: ${label}`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const career = (id, links = [], fields = {}) => normalizeCareer({ id, title: `live ${id}`, documentIds: links, ...fields });
const original = (id, label = id, links = []) => {
  const bytes = content(label);
  return { id, name: `${id}.txt`, size: bytes.length, mime: 'text/plain', createdAt: '2026-01-01T00:00:00.000Z', text: 'synthetic preview', analysisStatus: 'reviewed', recordIds: links, sha256: digest(bytes), bytes };
};
const storedDocument = (input, fields = {}) => ({ ...normalizeDocumentRecord({ ...input, driveFileId: 'existing_drive_original', ...fields }), recordIds: input.recordIds });

function runtime(careers, documents = []) {
  const state = { snapshot: { careers: structuredClone(careers), documents: structuredClone(documents), revision: 7, activeVersion: 'current_version' }, reads: 0, uploads: [], activations: [], trashed: [], events: [] };
  globalThis[stateKey] = state;
  return state;
}
async function archive(careers, documents, options = {}) {
  const zip = new JSZip();
  const manifest = {
    format: 'career-archive', version: 1,
    ...(options.marker === false ? {} : { evidenceImport: options.marker ?? { format: 'career-evidence-import', version: 1 } }),
    careers, documents: documents.map(({ bytes, ...document }) => ({ ...document, filePath: `originals/${document.id}.txt` })),
  };
  options.mutateManifest?.(manifest);
  zip.file('manifest.json', JSON.stringify(manifest));
  for (const document of documents) zip.file(`originals/${document.id}.txt`, document.bytes);
  for (const [path, bytes] of Object.entries(options.extra ?? {})) zip.file(path, bytes, { createFolders: false });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new File([bytes], 'evidence-import.zip', { type: 'application/zip' });
}
async function prepared(careers, documents) { return readEvidenceImportFile(await archive(careers, documents)); }
const assertNoWrites = state => { assert.equal(state.uploads.length, 0); assert.equal(state.activations.length, 0); assert.deepEqual(state.trashed, []); };
const rootPath = 'careerArchives/test_owner';
function firestoreRuntimeState() {
  const initialCareer = career('career_one', [], { description: 'live description' });
  const rows = new Map([
    [rootPath, { activeVersion: 'live_version', revision: 11 }],
    [`${rootPath}/versions/live_version/careers/${initialCareer.id}`, initialCareer],
  ]);
  const state = { rows, events: [], batches: [] };
  globalThis[firestoreStateKey] = state;
  return state;
}

test('evidence packages use the bounded backup parser and derive many-to-many links from carrier careers', async () => {
  const document = original('incoming_one', 'one', ['untrusted_manifest_link']);
  const result = await prepared([career('career_one', [document.id]), career('career_two', [document.id])], [document]);
  assert.equal(result.format, 'career-evidence-import');
  assert.equal(result.version, 1);
  assert.deepEqual(result.documents[0].bytes, document.bytes);
  assert.equal(result.documents[0].sha256, digest(document.bytes));
  assert.deepEqual(result.documents[0].recordIds, ['career_one', 'career_two']);
});

test('normal backup ZIPs and unrecognized evidence markers cannot enter additive import', async () => {
  const document = original('incoming_one');
  const carriers = [career('career_one', [document.id])];
  await assert.rejects(readEvidenceImportFile(await archive(carriers, [document], { marker: false })));
  await assert.rejects(readEvidenceImportFile(await archive(carriers, [document], { marker: { format: 'career-evidence-import', version: 2 } })));
  await assert.rejects(readEvidenceImportFile(await archive(carriers, [document], { marker: { format: 'unknown', version: 1 } })));
});

test('a marked evidence package cannot be mistaken for a full replacement backup', async () => {
  const document = original('incoming_one');
  await assert.rejects(readBackupFile(await archive([career('career_one', [document.id])], [document])));
});

test('review career choices come from a fresh live snapshot without any mutation', async () => {
  const state = runtime([career('career_one', [], { title: 'latest user title' }), career('recently_added')]);
  const before = structuredClone(state.snapshot);
  const result = await readEvidenceImportReviewCareers();
  assert.deepEqual(result, before.careers);
  assert.equal(state.reads, 1);
  assertNoWrites(state);
  assert.deepEqual(state.snapshot, before);
  result[0].title = 'local review edit';
  assert.equal(state.snapshot.careers[0].title, 'latest user title');
});

test('tampered originals, absent targets inside the carrier, and unsafe ZIP paths are rejected during parsing', async () => {
  const document = original('incoming_one');
  const carriers = [career('career_one', [document.id])];
  await assert.rejects(readEvidenceImportFile(await archive(carriers, [document], { mutateManifest: manifest => { manifest.documents[0].sha256 = '0'.repeat(64); } })));
  await assert.rejects(readEvidenceImportFile(await archive([career('career_one', ['missing_document'])], [document])));
  await assert.rejects(readEvidenceImportFile(await archive(carriers, [document], { extra: { '../outside.txt': content('outside') } })));
});

test('additive import preserves every current career field and only appends evidence links', async () => {
  const old = original('old_doc', 'old_doc', ['career_one']);
  const existing = storedDocument(old, { name: 'user_renamed.txt', text: 'user revised original metadata' });
  const live = career('career_one', [existing.id], { title: '사용자가 수정한 최신 경력', category: '위원회·지원단', organization: '최신 기관', role: '최신 역할', startDate: '2025-03', endDate: '2025-12', datePrecision: 'month', description: '최근 변경한 설명', tags: ['사용자 태그'], verified: false, source: 'user maintained source' });
  const incoming = original('incoming_one');
  const carrier = career(live.id, [incoming.id], { title: '오래된 제목', organization: '오래된 기관', description: '오래된 설명', tags: ['옛 태그'], verified: true });
  const state = runtime([live], [existing]);
  const progress = [];
  const stats = await applyEvidenceImport(await prepared([carrier], [incoming]), { onProgress: value => progress.push(value) });
  assert.equal(state.reads, 1, 'merge must obtain a fresh live snapshot');
  assert.deepEqual(state.snapshot.careers, [{ ...live, documentIds: [old.id, incoming.id], evidenceStatus: 'attached' }]);
  assert.deepEqual(state.snapshot.documents.find(document => document.id === existing.id), existing);
  assert.equal(state.snapshot.documents.length, 2);
  assert.equal(state.snapshot.documents.find(document => document.id === incoming.id).driveFileId, 'owned_upload_0');
  assert.deepEqual(state.uploads[0], { name: incoming.name, kind: 'document', sha256: incoming.sha256, bytes: incoming.bytes });
  assert.equal(state.activations[0].revision, 7);
  assert.equal(state.activations[0].activeVersion, 'current_version');
  assert.equal(stats.added, 1);
  assert.equal(stats.duplicates, 0);
  assert.equal(stats.linked, 1);
  assert.equal(stats.careersUpdated, 1);
  assert.deepEqual(state.trashed, []);
  assert.ok(progress.some(value => value.phase === 'uploading'));
  assert.ok(progress.some(value => value.phase === 'saving'));
  assert.equal(progress.at(-1).phase, 'done');
});

test('a SHA duplicate reuses the live document ID and immutable metadata for many-to-many links', async () => {
  const incoming = original('different_incoming_id', 'same bytes');
  const existing = storedDocument(original('live_doc', 'same bytes', ['career_one']), { name: 'retained_name.txt', text: 'retained extracted text', analysisStatus: 'user approved' });
  const first = career('career_one', [existing.id]);
  const second = career('career_two');
  const state = runtime([first, second], [existing]);
  const stats = await applyEvidenceImport(await prepared([career(first.id, [incoming.id]), career(second.id, [incoming.id])], [incoming]));
  assert.equal(state.uploads.length, 0);
  assert.equal(state.snapshot.documents.length, 1);
  const liveDocument = state.snapshot.documents[0];
  const { recordIds: _recordIds, ...metadata } = liveDocument;
  const { recordIds: _existingLinks, ...expectedMetadata } = existing;
  assert.deepEqual(metadata, expectedMetadata);
  assert.deepEqual(state.snapshot.careers.map(item => item.documentIds), [['live_doc'], ['live_doc']]);
  assert.equal(stats.added, 0);
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.linked, 1);
  assert.equal(stats.careersUpdated, 1);
});

test('approved links replace proposals while preserving unrelated careers and allowing unmatched documents', async () => {
  const linked = original('incoming_linked');
  const unmatched = original('incoming_unmatched');
  const unrelated = career('unrelated', [], { title: '별도 경력', evidenceStatus: 'unneeded' });
  const state = runtime([career('career_one'), career('career_two'), unrelated]);
  const input = await prepared([career('career_one', [linked.id, unmatched.id]), career('career_two')], [linked, unmatched]);
  const stats = await applyEvidenceImport(input, { approvedLinks: { [linked.id]: ['career_two'], [unmatched.id]: [] } });
  assert.deepEqual(state.snapshot.careers.find(item => item.id === 'career_one').documentIds, []);
  assert.deepEqual(state.snapshot.careers.find(item => item.id === 'career_two').documentIds, [linked.id]);
  assert.deepEqual(state.snapshot.careers.find(item => item.id === 'unrelated'), unrelated);
  assert.equal(state.snapshot.documents.length, 2);
  assert.equal(stats.unmatched, 1);
});

test('retrying the same stable import adds no originals, links, or archive revisions', async () => {
  const incoming = original('stable_incoming_id');
  const state = runtime([career('career_one')]);
  const input = await prepared([career('career_one', [incoming.id])], [incoming]);
  await applyEvidenceImport(input);
  const saved = structuredClone(state.snapshot);
  const count = state.activations.length;
  const stats = await applyEvidenceImport(input);
  assert.equal(state.uploads.length, 1);
  assert.equal(state.activations.length, count);
  assert.deepEqual(state.snapshot, saved);
  assert.equal(stats.added, 0);
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.linked, 0);
  assert.equal(stats.careersUpdated, 0);
});

test('a deleted selected career fails before any original upload or activation', async () => {
  const incoming = original('incoming_one');
  const state = runtime([career('unrelated')]);
  const before = structuredClone(state.snapshot);
  await assert.rejects(applyEvidenceImport(await prepared([career('deleted_target', [incoming.id])], [incoming])));
  assertNoWrites(state);
  assert.deepEqual(state.snapshot, before);
});

test('malformed approved mappings and colliding document IDs fail before uploads', async () => {
  const incoming = original('incoming_one');
  const input = await prepared([career('career_one', [incoming.id])], [incoming]);
  for (const approvedLinks of [{}, { unknown_document: ['career_one'] }, { [incoming.id]: ['missing_career'] }, { [incoming.id]: 'career_one' }, { [incoming.id]: [42] }]) {
    const state = runtime([career('career_one')]);
    await assert.rejects(applyEvidenceImport(input, { approvedLinks }));
    assertNoWrites(state);
  }
  const existing = storedDocument(original(incoming.id, 'different bytes'));
  const state = runtime([career('career_one')], [existing]);
  await assert.rejects(applyEvidenceImport(input));
  assertNoWrites(state);
});

test('post-preview byte tampering is rejected before any original upload', async () => {
  const incoming = original('incoming_one');
  const input = await prepared([career('career_one', [incoming.id])], [incoming]);
  input.documents[0].bytes = content('changed since preview');
  const state = runtime([career('career_one')]);
  await assert.rejects(applyEvidenceImport(input));
  assertNoWrites(state);
});

test('an already cancelled import has no side effects', async () => {
  const incoming = original('incoming_one');
  const controller = new AbortController();
  controller.abort();
  const state = runtime([career('career_one')]);
  await assert.rejects(applyEvidenceImport(await prepared([career('career_one', [incoming.id])], [incoming]), { signal: controller.signal }));
  assertNoWrites(state);
});

test('cancellation after an uploaded original cleans that file without publishing partial data', async () => {
  const one = original('incoming_one'), two = original('incoming_two');
  const state = runtime([career('career_one')]);
  const before = structuredClone(state.snapshot);
  const controller = new AbortController();
  state.onUpload = async () => controller.abort();
  await assert.rejects(applyEvidenceImport(await prepared([career('career_one', [one.id, two.id])], [one, two]), { signal: controller.signal }));
  assert.equal(state.uploads.length, 1);
  assert.equal(state.activations.length, 0);
  assert.deepEqual(state.trashed, ['owned_upload_0']);
  assert.deepEqual(state.snapshot, before);
});

test('an upload failure cleans only successful new uploads and never an existing reused original', async () => {
  const one = original('incoming_one'), two = original('incoming_two');
  const duplicate = original('incoming_duplicate', 'same existing bytes');
  const existing = storedDocument(original('existing_document', 'same existing bytes'));
  const state = runtime([career('career_one')], [existing]);
  const before = structuredClone(state.snapshot);
  state.failUploadAt = 1;
  await assert.rejects(applyEvidenceImport(await prepared([career('career_one', [one.id, two.id, duplicate.id])], [one, two, duplicate])));
  assert.equal(state.uploads.length, 2);
  assert.equal(state.activations.length, 0);
  assert.deepEqual(state.trashed, ['owned_upload_0']);
  assert.deepEqual(state.snapshot, before);
});

test('a staging failure or concurrent archive mutation cleans new uploads and leaves live data active', async () => {
  const incoming = original('incoming_one');
  const input = await prepared([career('career_one', [incoming.id])], [incoming]);
  for (const scenario of ['staging', 'concurrent']) {
    const state = runtime([career('career_one')]);
    if (scenario === 'staging') state.failure = 'staging';
    else state.onStage = async () => { state.snapshot.revision++; state.snapshot.careers[0].description = 'concurrent edit'; };
    await assert.rejects(applyEvidenceImport(input));
    assert.equal(state.activations.length, 1);
    assert.deepEqual(state.trashed, ['owned_upload_0']);
    assert.deepEqual(state.snapshot.careers[0].documentIds, []);
    assert.equal(state.snapshot.documents.length, 0);
    if (scenario === 'concurrent') assert.equal(state.snapshot.careers[0].description, 'concurrent edit');
    assert.ok(!state.events.includes('commit'));
  }
});

test('cancellation during staging cleans uploads before commit begins', async () => {
  const incoming = original('incoming_one');
  const state = runtime([career('career_one')]);
  const controller = new AbortController();
  state.onStage = async () => controller.abort();
  await assert.rejects(applyEvidenceImport(await prepared([career('career_one', [incoming.id])], [incoming]), { signal: controller.signal }));
  assert.deepEqual(state.trashed, ['owned_upload_0']);
  assert.ok(!state.events.includes('commit'));
  assert.deepEqual(state.snapshot.careers[0].documentIds, []);
});

test('an uncertain commit retains new originals that might already be referenced by the active archive', async () => {
  const incoming = original('incoming_one');
  const state = runtime([career('career_one')]);
  state.failure = 'uncertain';
  await assert.rejects(applyEvidenceImport(await prepared([career('career_one', [incoming.id])], [incoming])));
  assert.equal(state.activations.length, 1);
  assert.ok(state.events.includes('commit'));
  assert.deepEqual(state.trashed, []);
});

test('a definite revision conflict after commit begins cleans uploads because no root write was attempted', async () => {
  const incoming = original('incoming_one');
  const state = runtime([career('career_one')]);
  const before = structuredClone(state.snapshot);
  state.failure = 'definite-conflict';
  await assert.rejects(applyEvidenceImport(await prepared([career('career_one', [incoming.id])], [incoming])), { name: 'ArchiveRevisionConflictError' });
  assert.ok(state.events.includes('commit'));
  assert.deepEqual(state.trashed, ['owned_upload_0']);
  assert.deepEqual(state.snapshot, before);
});

test('an uncertain error with the same name as a definite conflict still retains uploaded originals', async () => {
  const incoming = original('incoming_one');
  const state = runtime([career('career_one')]);
  state.failure = 'spoofed-conflict';
  await assert.rejects(applyEvidenceImport(await prepared([career('career_one', [incoming.id])], [incoming])));
  assert.ok(state.events.includes('commit'));
  assert.deepEqual(state.trashed, []);
});

test('actual Firestore staging cancellation stops before the next batch and leaves the live root intact', async () => {
  const state = firestoreRuntimeState();
  const controller = new AbortController();
  let commitStarted = false;
  const document = storedDocument(original('incoming_one'));
  const careers = Array.from({ length: 401 }, (_, index) => career(`incoming_career_${index}`, [document.id]));
  state.onBatchCommit = async () => controller.abort();
  await assert.rejects(activateActualStore({ careers, documents: [document] }, 11, 'live_version', { signal: controller.signal, onCommitStarted: () => { commitStarted = true; } }), { name: 'AbortError' });
  assert.equal(state.batches.length, 1, 'the next staging batch must never be submitted after cancellation');
  assert.equal(state.batches[0].length, 400);
  assert.equal(commitStarted, false);
  assert.ok(!state.events.includes('transaction-start'));
  assert.deepEqual(state.rows.get(rootPath), { activeVersion: 'live_version', revision: 11 });
  const live = await readActualStore();
  assert.equal(live.careers.length, 1);
  assert.equal(live.careers[0].id, 'career_one');
  assert.deepEqual(live.documents, []);
});

test('actual Firestore compare-and-swap refuses a root revision changed during staging', async () => {
  const state = firestoreRuntimeState();
  const document = storedDocument(original('incoming_one'));
  const careers = [career('career_one', [document.id])];
  let commitStarted = false;
  state.onBatchCommit = async () => {
    state.rows.set(rootPath, { activeVersion: 'live_version', revision: 12 });
    state.rows.get(`${rootPath}/versions/live_version/careers/career_one`).description = 'concurrent user edit';
  };
  await assert.rejects(activateActualStore({ careers, documents: [document] }, 11, 'live_version', { onCommitStarted: () => { commitStarted = true; state.events.push('commit-started'); } }), error => {
    assert.ok(error instanceof ArchiveRevisionConflictError, 'the first failed CAS proves no root write has been attempted');
    return true;
  });
  assert.equal(commitStarted, true, 'the cleanup guard becomes conservative before entering the transaction');
  assert.ok(state.events.indexOf('commit-started') < state.events.indexOf('transaction-read'));
  assert.ok(!state.events.includes('transaction-root-write'));
  assert.deepEqual(state.rows.get(rootPath), { activeVersion: 'live_version', revision: 12 });
  const live = await readActualStore();
  assert.equal(live.revision, 12);
  assert.equal(live.careers[0].description, 'concurrent user edit');
  assert.deepEqual(live.careers[0].documentIds, []);
  assert.deepEqual(live.documents, []);
});

test('an actual transaction retry conflict remains uncertain after an earlier callback scheduled a root write', async () => {
  const state = firestoreRuntimeState();
  const document = storedDocument(original('incoming_one'));
  const careers = [career('career_one', [document.id])];
  let commitStarted = false;
  state.retryAfterFirstAttempt = async writes => {
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], rootPath);
    state.rows.set(rootPath, { activeVersion: 'live_version', revision: 12 });
    state.rows.get(`${rootPath}/versions/live_version/careers/career_one`).description = 'edit before retry';
  };
  await assert.rejects(activateActualStore({ careers, documents: [document] }, 11, 'live_version', { onCommitStarted: () => { commitStarted = true; } }), error => {
    assert.ok(!(error instanceof ArchiveRevisionConflictError), 'a retry must preserve uncertainty after a prior root write callback');
    return true;
  });
  assert.equal(commitStarted, true);
  assert.equal(state.events.filter(event => event === 'transaction-read').length, 2);
  assert.equal(state.events.filter(event => event === 'transaction-root-write').length, 1);
  assert.ok(!state.events.includes('transaction-commit'));
  assert.deepEqual(state.rows.get(rootPath), { activeVersion: 'live_version', revision: 12 });
  const live = await readActualStore();
  assert.equal(live.careers[0].description, 'edit before retry');
  assert.deepEqual(live.careers[0].documentIds, []);
  assert.deepEqual(live.documents, []);
});

test('actual Firestore activation stages normalized metadata and signals commit before the root switch', async () => {
  const state = firestoreRuntimeState();
  const document = storedDocument(original('incoming_one', 'one', ['untrusted_metadata_link']));
  const careers = [career('career_one', [document.id]), career('career_two', [document.id])];
  let starts = 0;
  await activateActualStore({ careers, documents: [document] }, 11, 'live_version', { onCommitStarted: () => { starts++; state.events.push('commit-started'); } });
  assert.equal(starts, 1);
  assert.ok(state.events.indexOf('batch-commit') < state.events.indexOf('commit-started'));
  assert.ok(state.events.indexOf('commit-started') < state.events.indexOf('transaction-root-write'));
  const root = state.rows.get(rootPath);
  assert.equal(root.revision, 12);
  assert.notEqual(root.activeVersion, 'live_version');
  const storedMetadata = state.rows.get(`${rootPath}/versions/${root.activeVersion}/documents/${document.id}`);
  assert.equal(Object.hasOwn(storedMetadata, 'recordIds'), false, 'document links are derived from careers rather than trusted input');
  const live = await readActualStore();
  assert.deepEqual(live.careers, careers);
  assert.deepEqual(live.documents[0].recordIds, ['career_one', 'career_two']);
  assert.equal(live.documents[0].driveFileId, document.driveFileId);
  assert.equal(live.documents[0].sha256, document.sha256);
});
