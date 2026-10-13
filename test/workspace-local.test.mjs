import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { createApp } from '../server/index.mjs';
import { Store, normalizeCareer } from '../server/store.mjs';
import { saveWorkspaceItem, readWorkspace, exportWorkspaceArchive, importWorkspaceArchive } from '../server/workspace.mjs';
import { exportBackup, restoreBackup } from '../server/backup.mjs';
import { createHash } from 'node:crypto';
import { normalizeWorkspace } from '../shared/workspace.mjs';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-local-'));
  const store = new Store(directory, null);
  try { await run(store, directory); }
  finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}
const create = (store, item, links = []) => saveWorkspaceItem(store, { item, links, expectedRevision: readWorkspace(store).revision });
const itemOf = (data, kind) => data.items.find(item => item.kind === kind);
const archive = (careers = [], workspace = { schemaVersion: 1, items: [], links: [] }, documents = []) => ({ format: 'introduce-me-workspace', version: 1, createdAt: '2026-10-13T10:00:00Z', careers, documents, workspace });

test('near-cap workspace exports actual JSON and full ZIP bytes that both restore', () => fixture(async store => {
  const large = normalizeWorkspace({ schemaVersion: 1, items: Array.from({ length: 5000 }, (_, index) => ({
    id: `idea_${index}`, kind: 'idea', title: `Idea ${index}`, body: 'x'.repeat(850), tags: [],
  })), links: [] });
  store.putWorkspace(large);
  const exported = exportWorkspaceArchive(store);
  const bytes = Buffer.from(JSON.stringify(exported));
  assert.ok(bytes.length < 5 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(exported, null, 2)) > 5 * 1024 * 1024);
  const merged = importWorkspaceArchive(store, JSON.parse(bytes), readWorkspace(store).revision);
  assert.equal(merged.added.items, 0);
  const zipped = await exportBackup(store);
  const zip = await JSZip.loadAsync(zipped);
  assert.ok((await zip.file('manifest.json').async('nodebuffer')).length < 5 * 1024 * 1024);
  await restoreBackup(store, zipped);
  assert.deepEqual(readWorkspace(store).items, large.items);
}));

async function addOriginal(store, directory) {
  const bytes = Buffer.from('Synthetic private original only for isolated tests');
  const document = { id: 'original_one', name: 'evidence.txt', size: bytes.length, mime: 'text/plain', createdAt: '2025-01-01T00:00:00Z', text: bytes.toString(), analysisStatus: 'text', storageName: 'safe-original.txt', sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(join(directory, 'originals', document.storageName), bytes);
  store.putDocument(document);
  return { document, bytes };
}

test('local workspace migration preserves career and original data, persists across reopening', () => fixture(async (store, directory) => {
  const career = normalizeCareer({ id: 'existing_career', title: 'Existing private career', description: 'Edited before workspace migration' });
  store.putCareer(career);
  const { document, bytes } = await addOriginal(store, directory);
  const previousCareers = store.careers(), previousDocuments = store.documents();
  const data = create(store, { kind: 'project', title: 'New project', tags: ['digital'], photos: [{ label: 'Photo link', url: 'https://example.test/photo.png' }] }, ['career:existing_career']);
  assert.equal(data.items.length, 1); assert.equal(data.links.length, 1);
  assert.deepEqual(store.careers(), previousCareers); assert.deepEqual(store.documents(), previousDocuments);
  const reopened = new Store(directory, null);
  try { assert.deepEqual(readWorkspace(reopened), data); assert.deepEqual(reopened.career(career.id), career); }
  finally { reopened.close(); }
  assert.deepEqual(await readFile(join(directory, 'originals', document.storageName)), bytes);
}));

test('workspace HTTP CRUD is guarded by revisions, canonical links and course deletion preserves children', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-api-'));
  const service = createApp({ dataDir: directory, seedPath: null, localMode: true, automaticBackups: false });
  const server = await new Promise(resolve => { const listener = service.app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const request = (path, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const success = async response => { assert.ok(response.ok, await response.clone().text()); return response.json(); };
  try {
    assert.deepEqual(await success(await request('/workspace')), { schemaVersion: 1, items: [], links: [], revision: 0 });
    let workspace = await success(await request('/workspace/items', 'POST', { item: { kind: 'course', title: 'Methods' }, links: [], expectedRevision: 0 }));
    const course = itemOf(workspace, 'course');
    workspace = await success(await request('/workspace/items', 'POST', { item: { kind: 'assignment', title: 'Essay', courseId: course.id }, links: [`course:${course.id}`, `course:${course.id}`], expectedRevision: workspace.revision }));
    const assignment = itemOf(workspace, 'assignment');
    workspace = await success(await request('/workspace/items', 'POST', { item: { kind: 'paper', title: 'A paper', courseIds: [course.id], quotations: [{ text: 'Quotation', page: '12' }] }, links: [`assignment:${assignment.id}`], expectedRevision: workspace.revision }));
    assert.equal(workspace.links.length, 2); assert.ok(workspace.links.every(link => link.from < link.to));
    const stale = await request(`/workspace/items/${assignment.id}`, 'PUT', { item: { ...assignment, title: 'Must not overwrite' }, links: [], expectedRevision: 0 });
    assert.equal(stale.status, 409);
    workspace = await success(await request(`/workspace/items/${course.id}`, 'DELETE', { expectedRevision: workspace.revision }));
    assert.equal(workspace.items.length, 2); assert.equal(itemOf(workspace, 'assignment').courseId, ''); assert.deepEqual(itemOf(workspace, 'paper').courseIds, []);
    assert.equal(itemOf(workspace, 'assignment').title, 'Essay'); assert.equal(workspace.links.length, 1);
    const before = await success(await request('/workspace'));
    const unsafe = await request('/workspace/items', 'POST', { item: { kind: 'material', title: 'Unsafe', fileUrl: 'javascript:alert(1)' }, links: [], expectedRevision: workspace.revision });
    assert.equal(unsafe.status, 400); assert.deepEqual(await success(await request('/workspace')), before);
    const exported = await success(await request('/workspace/export'));
    assert.equal(exported.format, 'introduce-me-workspace'); assert.equal(exported.workspace.items.length, 2);
    const imported = await success(await request('/workspace/import', 'POST', { archive: exported, expectedRevision: workspace.revision }));
    assert.equal(imported.added.items, 0); assert.deepEqual(imported.conflicts, []);
  } finally { await new Promise(resolve => server.close(resolve)); service.close(); await rm(directory, { recursive: true, force: true }); }
});

test('JSON merge retains edited careers and originals, reuses hashes and reports missing original references', () => fixture(async (store, directory) => {
  const { document, bytes } = await addOriginal(store, directory);
  const existing = normalizeCareer({ id: 'career_one', title: 'Latest edited title', verified: true, documentIds: [document.id] });
  store.putCareer(existing);
  const exported = exportWorkspaceArchive(store);
  assert.ok(!JSON.stringify(exported).includes('storageName')); assert.ok(!JSON.stringify(exported).includes('filePath'));
  const doc = { ...exported.documents[0], id: 'different_source_id' };
  const imported = archive([
    { ...existing, title: 'Outdated title', documentIds: [doc.id] },
    normalizeCareer({ id: 'new_career', title: 'New role', documentIds: [doc.id] }),
  ], undefined, [doc]);
  const result = importWorkspaceArchive(store, imported, 0);
  assert.equal(result.added.careers, 1); assert.equal(result.added.documents, 0);
  assert.ok(result.conflicts.some(conflict => conflict.ref === 'career:career_one'));
  assert.deepEqual(store.career(existing.id), existing); assert.deepEqual(store.career('new_career').documentIds, [document.id]);
  assert.equal(store.documents().length, 1); assert.deepEqual(await readFile(join(directory, 'originals', document.storageName)), bytes);
  const changedMetadata = archive([], undefined, [{ ...exported.documents[0], name: 'renamed.txt' }]);
  const preservedMetadata = importWorkspaceArchive(store, changedMetadata, result.workspace.revision);
  assert.ok(preservedMetadata.conflicts.some(conflict => conflict.ref === `document:${document.id}`));
  assert.deepEqual(store.document(document.id), document);
  const unavailable = { ...doc, id: 'missing_doc', sha256: 'a'.repeat(64) };
  const missing = archive([normalizeCareer({ id: 'unavailable_career', title: 'Requires unavailable evidence', documentIds: [unavailable.id] })], undefined, [unavailable]);
  const failed = importWorkspaceArchive(store, missing, preservedMetadata.workspace.revision);
  assert.equal(failed.added.careers, 0); assert.ok(failed.conflicts.some(conflict => conflict.ref === 'document:missing_doc')); assert.equal(store.career('unavailable_career'), null);
}));

test('JSON HTTP imports can carry more than 1 MB without rewriting existing data and career deletion detaches links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-large-api-'));
  const service = createApp({ dataDir: directory, seedPath: null, localMode: true, automaticBackups: false });
  const server = await new Promise(resolve => { const listener = service.app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const careers = Array.from({ length: 120 }, (_, index) => normalizeCareer({ id: `json_career_${index}`, title: `Career ${index}`, description: 'x'.repeat(10000) }));
    const response = await fetch(`${base}/workspace/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archive: archive(careers), expectedRevision: 0 }) });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).added.careers, 120);
    const workspace = create(service.store, { kind: 'idea', title: 'Retained after career removal' }, ['career:json_career_0']);
    assert.equal((await fetch(`${base}/careers/json_career_0`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(readWorkspace(service.store).items, workspace.items); assert.deepEqual(readWorkspace(service.store).links, []);
    assert.equal(service.store.careers().length, 119);
  } finally { await new Promise(resolve => server.close(resolve)); service.close(); await rm(directory, { recursive: true, force: true }); }
});

test('JSON rejects forged local paths and malformed workspace atomically; career-only JSON preserves workspace', () => fixture(async store => {
  const current = create(store, { kind: 'idea', title: 'Preserve this idea', body: 'Saved text' });
  const career = normalizeCareer({ id: 'new_career', title: 'Imported career' });
  const malformed = archive([career], { schemaVersion: 1, items: [{ id: 'unsafe', kind: 'project', title: 'Unsafe photo', photos: [{ label: '', url: 'http://example.test/photo' }] }], links: [] });
  assert.throws(() => importWorkspaceArchive(store, malformed, current.revision));
  assert.equal(store.career(career.id), null); assert.deepEqual(readWorkspace(store), current);
  const forged = archive([], undefined, [{ id: 'forged', name: 'file.txt', size: 1, sha256: '1'.repeat(64), storageName: '../../secret' }]);
  assert.throws(() => importWorkspaceArchive(store, forged, current.revision), /경로/);
  assert.deepEqual(readWorkspace(store), current);
  const upgraded = importWorkspaceArchive(store, { format: 'career-archive', version: 1, careers: [career], documents: [] }, current.revision);
  assert.equal(upgraded.added.careers, 1); assert.deepEqual(upgraded.workspace.items, current.items);
  assert.throws(() => importWorkspaceArchive(store, archive(), current.revision), error => error.status === 409);
}));

test('re-enabling workspace after old-version career deletion retains items and prunes only missing career links', () => fixture(async store => {
  store.putCareer(normalizeCareer({ id: 'old_version_career', title: 'Career to delete in older app' }));
  const workspace = create(store, { kind: 'idea', title: 'Keep my graduate idea', body: 'Unaffected content' }, ['career:old_version_career']);
  // Simulate the old checkpoint, which knows nothing about workspace cleanup.
  store.deleteCareer('old_version_career');
  const visible = readWorkspace(store);
  assert.deepEqual(visible.items, workspace.items); assert.deepEqual(visible.links, []);
  assert.deepEqual(exportWorkspaceArchive(store).workspace.items, workspace.items);
  const zip = await JSZip.loadAsync(await exportBackup(store));
  const exported = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.deepEqual(exported.workspace.items, workspace.items); assert.deepEqual(exported.workspace.links, []);
}));

test('full ZIP includes workspace, selected evidence omits it, old ZIP preserves items and detaches removed career edges', () => fixture(async (store, directory) => {
  const { document, bytes } = await addOriginal(store, directory);
  const career = normalizeCareer({ id: 'career_one', title: 'Career', documentIds: [document.id] });
  store.putCareer(career);
  const workspace = create(store, { kind: 'project', title: 'Project preserved by legacy backup' }, [`career:${career.id}`]);
  const full = await exportBackup(store);
  const zip = await JSZip.loadAsync(full);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.workspace.items.length, 1); assert.equal(manifest.workspace.links.length, 1);
  const selected = await JSZip.loadAsync(await exportBackup(store, [career.id]));
  assert.equal(JSON.parse(await selected.file('manifest.json').async('string')).workspace, undefined);
  const legacy = new JSZip(); legacy.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, careers: [], documents: [] }));
  const oldResult = await restoreBackup(store, await legacy.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(readWorkspace(store).items, workspace.items); assert.deepEqual(readWorkspace(store).links, []); assert.equal(oldResult.detachedWorkspaceLinks, 1);
  await restoreBackup(store, full);
  assert.deepEqual(readWorkspace(store).items, workspace.items); assert.deepEqual(readWorkspace(store).links, workspace.links);
  assert.deepEqual(await readFile(join(directory, 'originals', store.document(document.id).storageName)), bytes);
  const before = store.careers();
  manifest.workspace.links.push({ from: `project:${workspace.items[0].id}`, to: 'career:absent' });
  zip.file('manifest.json', JSON.stringify(manifest));
  await assert.rejects(restoreBackup(store, await zip.generateAsync({ type: 'nodebuffer' })));
  assert.deepEqual(store.careers(), before);
}));
