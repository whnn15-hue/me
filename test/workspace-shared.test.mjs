import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyWorkspace,
  isWorkspaceMetadataRow,
  mergeWorkspaceData,
  mutateWorkspace,
  normalizeWorkspace,
  normalizeWorkspaceItem,
  normalizeWorkspaceUrl,
  parseWorkspaceRef,
  workspaceFromRows,
  workspaceToRows,
} from '../shared/workspace.mjs';

const stamp = '2026-10-13T01:00:00.000Z';
const item = (id, kind = 'idea', fields = {}) => ({ id, kind, title: `${kind} ${id}`, tags: [], createdAt: stamp, updatedAt: stamp, ...fields });
const workspace = (items = [], links = [], revision = 0) => ({ schemaVersion: 1, items, links, revision });
const badRequest = error => error.status === 400;
const canonical = (a, b) => { const [from, to] = [a, b].sort(); return { from, to }; };

test('optional classroom purpose preserves legacy material shape and rejects unrecognized placement', () => {
  const legacy = normalizeWorkspaceItem(item('old_material', 'material', { format: 'PPT', summary: 'Unchanged lecture material' }));
  assert.equal(Object.hasOwn(legacy, 'purpose'), false);
  assert.deepEqual(normalizeWorkspaceItem(legacy), legacy);
  for (const format of ['HWP', 'TXT']) {
    const classroom = normalizeWorkspaceItem(item(`classroom_${format}`, 'material', { purpose: 'classroom', format }));
    assert.equal(classroom.purpose, 'classroom');
    assert.equal(classroom.format, format);
    assert.equal(normalizeWorkspaceItem({ title: 'Edited activity' }, classroom).purpose, 'classroom');
  }
  const lecture = normalizeWorkspaceItem(item('new_lecture', 'material', { purpose: 'lecture' }));
  assert.equal(lecture.purpose, 'lecture');
  for (const purpose of ['', null, 'project', false, 0, {}]) {
    assert.throws(() => normalizeWorkspaceItem(item('invalid_material', 'material', { purpose })), badRequest);
  }
});

test('classroom rows survive metadata and backup merges without changing lectures, lessons or their links', () => {
  const old = normalizeWorkspace(workspace([
    item('old_material', 'material', { format: 'PDF', summary: 'Saved lecture' }),
    item('old_project', 'project', { schoolYear: '2025', drivingQuestion: 'Saved question' }),
  ], [{ from: 'material:old_material', to: 'project:old_project' }], 4));
  const before = structuredClone(old);
  const incoming = workspace([item('classroom_material', 'material', { purpose: 'classroom', format: 'HWP', summary: 'Class activity' }), ...old.items], [
    { from: 'material:classroom_material', to: 'project:old_project' }, ...old.links,
  ]);
  const merged = mergeWorkspaceData(old, incoming, []);
  assert.deepEqual(merged.added, { items: 1, links: 1 });
  assert.deepEqual(merged.conflicts, []);
  for (const previous of old.items) assert.deepEqual(merged.workspace.items.find(value => value.id === previous.id), previous);
  const restored = workspaceFromRows(workspaceToRows(merged.workspace), [], 4);
  assert.deepEqual(restored, merged.workspace);
  assert.deepEqual(mergeWorkspaceData(restored, incoming, []).added, { items: 0, links: 0 });
  assert.deepEqual(old, before);
});

test('web links reject executable schemes, credentials and Drive lookalikes; photos require HTTPS', () => {
  assert.equal(normalizeWorkspaceUrl('  https://example.test/path?q=one#two  '), 'https://example.test/path?q=one#two');
  assert.equal(normalizeWorkspaceUrl('http://example.test'), 'http://example.test/');
  assert.equal(normalizeWorkspaceUrl(''), '');
  for (const value of ['javascript:alert(1)', 'data:text/plain,private', 'file:///tmp/private', '//example.test/file', 'https://user:secret@example.test/']) {
    assert.throws(() => normalizeWorkspaceUrl(value), badRequest, value);
  }
  for (const value of ['https://drive.google.com/file/d/synthetic/view', 'https://docs.google.com/presentation/d/synthetic/edit']) {
    assert.equal(normalizeWorkspaceItem(item('material', 'material', { fileUrl: value })).fileUrl, value);
  }
  for (const value of ['http://drive.google.com/file/d/a', 'https://drive.google.com.evil.test/file', 'https://example.test/drive.google.com', 'https://drive.google.com:8443/file']) {
    assert.throws(() => normalizeWorkspaceItem(item('material', 'material', { fileUrl: value })), badRequest, value);
  }
  assert.throws(() => normalizeWorkspaceItem(item('photo', 'project', { photos: [{ label: 'Photo', url: 'http://example.test/photo' }] })), badRequest);
  assert.equal(normalizeWorkspaceItem(item('photo', 'project', { photos: [{ label: 'Photo', url: 'https://example.test/photo' }] })).photos[0].url, 'https://example.test/photo');
});

test('dates support year and month precision but reject impossible days and reversed project periods', () => {
  for (const date of ['', '2024', '2024-02', '2024-02-29']) {
    assert.equal(normalizeWorkspaceItem(item('material', 'material', { date })).date, date);
    assert.equal(normalizeWorkspaceItem(item('assignment', 'assignment', { dueDate: date })).dueDate, date);
  }
  for (const date of ['2023-02-29', '2024-02-30', '2024-04-31', '2024-13', '2024-00', '2024-01-00', '2024/01/01', '2024-1-1']) {
    assert.throws(() => normalizeWorkspaceItem(item('material', 'material', { date })), badRequest, date);
  }
  assert.throws(() => normalizeWorkspaceItem(item('project', 'project', { startDate: '2026-02-02', endDate: '2026-02-01' })), badRequest);
  const sameDay = normalizeWorkspaceItem(item('project', 'project', { startDate: '2026-02-01', endDate: '2026-02-01' }));
  assert.equal(sameDay.startDate, sameDay.endDate);
});

test('item normalization preserves stable identity and created time without carrying foreign original bytes or arbitrary metadata', () => {
  const previous = normalizeWorkspaceItem(item('saved_idea', 'idea', { title: 'Original title', body: 'Saved body', tags: ['existing'] }));
  const input = { id: 'replacement_id', title: '  Changed title  ', createdAt: '2025-01-01T00:00:00Z', tags: [' media ', 'media', '', 'lesson'], storageName: '../private-original.pdf', driveFileId: 'foreign_original', bytes: [1, 2, 3], unknownField: 'omit' };
  const before = structuredClone({ previous, input });
  const changed = normalizeWorkspaceItem(input, previous);
  assert.equal(changed.id, previous.id);
  assert.equal(changed.createdAt, previous.createdAt);
  assert.equal(changed.body, previous.body);
  assert.equal(changed.title, 'Changed title');
  assert.deepEqual(changed.tags, ['media', 'lesson']);
  for (const key of ['storageName', 'driveFileId', 'bytes', 'unknownField']) assert.equal(Object.hasOwn(changed, key), false, key);
  assert.deepEqual({ previous, input }, before);
  assert.throws(() => normalizeWorkspaceItem({ kind: 'paper' }, previous), badRequest);
  assert.throws(() => normalizeWorkspaceItem(item('__workspace_original', 'idea')), badRequest);
  assert.throws(() => normalizeWorkspaceItem(item('invalid', 'idea', { tags: [42] })), badRequest);
});

test('links normalize to one sorted undirected edge and only explicitly stale career edges are pruned', () => {
  const records = [item('project_one', 'project'), item('material_one', 'material'), item('idea_one')];
  const p = 'project:project_one', m = 'material:material_one', i = 'idea:idea_one', c = 'career:career_one';
  const input = workspace(records, [{ from: p, to: m }, { from: m, to: p }, { from: c, to: p }, { from: i, to: m }], 9);
  const normalized = normalizeWorkspace(input, { careerIds: ['career_one'] });
  assert.deepEqual(normalized.links, [canonical(c, p), canonical(i, m), canonical(p, m)]);
  assert.equal(normalized.revision, 9);
  const pruned = normalizeWorkspace(input, { pruneMissingCareerLinks: true });
  assert.deepEqual(pruned.items, normalized.items);
  assert.deepEqual(pruned.links, [canonical(i, m), canonical(p, m)]);
  assert.throws(() => normalizeWorkspace(input), badRequest);
  assert.throws(() => normalizeWorkspace(workspace(records, [{ from: p, to: 'paper:missing' }]), { pruneMissingCareerLinks: true }), badRequest);
  for (const link of [
    { from: 'career:removed', to: 'paper:missing' },
    { from: 'paper:missing', to: 'career:removed' },
  ]) assert.throws(() => normalizeWorkspace(workspace(records, [link]), { pruneMissingCareerLinks: true }), badRequest);
  assert.deepEqual(normalizeWorkspace(workspace(records, [{ from: 'career:removed_one', to: 'career:removed_two' }]), { pruneMissingCareerLinks: true }).links, []);
  // Old career IDs allow this prefix and up to 100 characters; new workspace
  // IDs keep their separate namespace restriction and 80-character limit.
  const legacyCareerId = `__workspace_${'c'.repeat(88)}`;
  const legacyRef = `career:${legacyCareerId}`;
  assert.equal(legacyCareerId.length, 100);
  assert.deepEqual(parseWorkspaceRef(legacyRef), { kind: 'career', id: legacyCareerId });
  assert.deepEqual(normalizeWorkspace(workspace(records, [{ from: p, to: legacyRef }]), { careerIds: [legacyCareerId], pruneMissingCareerLinks: true }).links, [canonical(p, legacyRef)]);
  assert.throws(() => normalizeWorkspaceItem(item('__workspace_legacy')), badRequest);
  assert.throws(() => normalizeWorkspace(workspace(records, [{ from: p, to: p }])), badRequest);
  for (const ref of ['document:original', 'idea:../private', 'idea:__workspace_meta_v1', 'unknown:one']) assert.throws(() => parseWorkspaceRef(ref), badRequest, ref);
});

test('revision guarded edits reconcile incident links while preserving unrelated edges and caller state', () => {
  const careers = [{ id: 'career_one', title: 'Synthetic career' }];
  const current = normalizeWorkspace(workspace([item('idea_one'), item('idea_two'), item('project_one', 'project')], [
    { from: 'idea:idea_one', to: 'idea:idea_two' },
    { from: 'idea:idea_two', to: 'project:project_one' },
  ], 4));
  const before = structuredClone(current);
  const mutation = { operation: 'update', id: 'idea_one', item: { title: 'Revised title' }, links: ['career:career_one', 'career:career_one'], expectedRevision: 4 };
  const next = mutateWorkspace(current, mutation, careers);
  assert.equal(next.revision, 5);
  assert.equal(next.items.find(record => record.id === 'idea_one').title, 'Revised title');
  assert.deepEqual(next.links, [canonical('career:career_one', 'idea:idea_one'), canonical('idea:idea_two', 'project:project_one')]);
  assert.deepEqual(current, before);
  for (const expectedRevision of [3, undefined, '4']) {
    assert.throws(() => mutateWorkspace(current, { ...mutation, expectedRevision }, careers), error => error.status === 409);
  }
  assert.throws(() => mutateWorkspace(current, { ...mutation, links: ['idea:missing'] }, careers), badRequest);
  assert.deepEqual(current, before);
});

test('deleting a course detaches only its children and edges without deleting assignments, papers or unrelated courses', () => {
  const records = [
    item('course_one', 'course'), item('course_two', 'course'),
    item('assignment_one', 'assignment', { courseId: 'course_one', status: 'submitted', submissionUrl: 'https://example.test/submission' }),
    item('assignment_two', 'assignment', { courseId: 'course_two' }),
    item('paper_one', 'paper', { courseIds: ['course_one', 'course_two'], quotations: [{ text: 'Saved quotation', page: '12' }] }),
  ];
  const current = normalizeWorkspace(workspace(records, [
    { from: 'assignment:assignment_one', to: 'course:course_one' },
    { from: 'assignment:assignment_one', to: 'paper:paper_one' },
    { from: 'course:course_two', to: 'paper:paper_one' },
  ], 2));
  const before = structuredClone(current);
  const next = mutateWorkspace(current, { operation: 'delete', id: 'course_one', expectedRevision: 2 }, []);
  assert.equal(next.revision, 3);
  assert.equal(next.items.length, 4);
  assert.equal(next.items.find(record => record.id === 'assignment_one').courseId, '');
  assert.equal(next.items.find(record => record.id === 'assignment_one').status, 'submitted');
  assert.equal(next.items.find(record => record.id === 'assignment_one').submissionUrl, 'https://example.test/submission');
  assert.deepEqual(next.items.find(record => record.id === 'assignment_two'), current.items.find(record => record.id === 'assignment_two'));
  assert.deepEqual(next.items.find(record => record.id === 'paper_one').courseIds, ['course_two']);
  assert.deepEqual(next.items.find(record => record.id === 'paper_one').quotations, [{ text: 'Saved quotation', page: '12' }]);
  assert.deepEqual(next.links, [canonical('assignment:assignment_one', 'paper:paper_one'), canonical('course:course_two', 'paper:paper_one')]);
  assert.deepEqual(current, before);
});

test('JSON workspace merge keeps current conflicting content, adds independent records and remains idempotent', () => {
  const current = normalizeWorkspace(workspace([item('saved_idea', 'idea', { body: 'Latest manually edited text', tags: ['current'] }), item('project_one', 'project')], [
    { from: 'idea:saved_idea', to: 'project:project_one' },
  ], 7));
  const importedIdea = item('imported_idea', 'idea', { body: 'Additional text', storageName: 'foreign.pdf', bytes: [1, 2] });
  const incoming = workspace([item('saved_idea', 'idea', { body: 'Outdated imported text', tags: ['old'] }), importedIdea], [
    { from: 'idea:imported_idea', to: 'idea:saved_idea' },
  ], 123);
  const before = structuredClone({ current, incoming });
  const result = mergeWorkspaceData(current, incoming, []);
  assert.deepEqual(result.workspace.items.find(record => record.id === 'saved_idea'), current.items.find(record => record.id === 'saved_idea'));
  assert.equal(result.workspace.items.find(record => record.id === 'imported_idea').body, 'Additional text');
  assert.equal(Object.hasOwn(result.workspace.items.find(record => record.id === 'imported_idea'), 'bytes'), false);
  assert.equal(Object.hasOwn(result.workspace.items.find(record => record.id === 'imported_idea'), 'storageName'), false);
  assert.equal(result.workspace.revision, 7);
  assert.deepEqual(result.added, { items: 1, links: 1 });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].ref, 'idea:saved_idea');
  const repeated = mergeWorkspaceData(result.workspace, incoming, []);
  assert.deepEqual(repeated.workspace, result.workspace);
  assert.deepEqual(repeated.added, { items: 0, links: 0 });
  assert.deepEqual(repeated.conflicts, result.conflicts);
  assert.deepEqual({ current, incoming }, before);
});

test('self-import of a densely linked workspace counts unique edges and remains a no-op', () => {
  const records = Array.from({ length: 111 }, (_, index) => item(`dense_${index}`));
  const links = [];
  for (let a = 0; a < records.length; a++) {
    for (let b = a + 1; b < records.length; b++) links.push({ from: `idea:${records[a].id}`, to: `idea:${records[b].id}` });
  }
  const current = normalizeWorkspace(workspace(records, links, 23));
  const incoming = structuredClone(current);
  const before = structuredClone({ current, incoming });
  assert.equal(current.links.length, 6105);
  const result = mergeWorkspaceData(current, incoming, []);
  assert.equal(result.workspace.links.length, 6105);
  assert.deepEqual(result.workspace, current);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.added, { items: 0, links: 0 });
  assert.deepEqual({ current, incoming }, before);
});

test('cross-kind import collisions preserve local records, detach imported course references and report discarded edges', () => {
  const current = normalizeWorkspace(workspace([item('collision', 'idea', { body: 'Local idea must remain' }), item('local_course', 'course')], [], 3));
  const incoming = workspace([
    item('collision', 'course'),
    item('assignment_one', 'assignment', { courseId: 'collision' }),
    item('paper_one', 'paper', { courseIds: ['collision'], summary: 'Keep imported notes' }),
  ], [
    { from: 'assignment:assignment_one', to: 'course:collision' },
    { from: 'assignment:assignment_one', to: 'paper:paper_one' },
  ]);
  const result = mergeWorkspaceData(current, incoming, []);
  assert.deepEqual(result.workspace.items.find(record => record.id === 'collision'), current.items[0]);
  assert.equal(result.workspace.items.find(record => record.id === 'assignment_one').courseId, '');
  assert.deepEqual(result.workspace.items.find(record => record.id === 'paper_one').courseIds, []);
  assert.equal(result.workspace.items.find(record => record.id === 'paper_one').summary, 'Keep imported notes');
  assert.deepEqual(result.workspace.links, [canonical('assignment:assignment_one', 'paper:paper_one')]);
  assert.deepEqual(result.added, { items: 2, links: 1 });
  assert.equal(result.conflicts.length, 4);
  for (const ref of ['course:collision', 'assignment:assignment_one', 'paper:paper_one']) assert.ok(result.conflicts.some(conflict => conflict.ref === ref));
  assert.ok(result.conflicts.some(conflict => conflict.ref.includes('course:collision') && conflict.ref.includes('assignment:assignment_one')));
});

test('invalid imports and workspace identities reject without modifying current data', () => {
  const current = normalizeWorkspace(workspace([item('saved_idea', 'idea', { body: 'Untouched' })], [], 5));
  const before = structuredClone(current);
  const invalid = [
    workspace([item('same'), item('same', 'course')]),
    workspace([item('assignment', 'assignment', { courseId: 'missing_course' })]),
    workspace([item('photo', 'project', { photos: [{ url: 'http://example.test/photo', label: '' }] })]),
    workspace([item('incoming')], [{ from: 'idea:incoming', to: 'career:foreign_career' }]),
    { ...emptyWorkspace(), revision: -1 },
    { ...emptyWorkspace(), schemaVersion: 2 },
  ];
  for (const incoming of invalid) {
    assert.throws(() => mergeWorkspaceData(current, incoming, []), badRequest);
    assert.deepEqual(current, before);
  }
});

test('namespaced storage rows round-trip multiple link chunks and reject missing, duplicate or forged rows', () => {
  const records = Array.from({ length: 16 }, (_, index) => item(`idea_${index}`));
  const links = [];
  for (let a = 0; a < records.length; a++) for (let b = a + 1; b < records.length; b++) links.push({ from: `idea:${records[a].id}`, to: `idea:${records[b].id}` });
  const current = normalizeWorkspace(workspace(records, links, 11));
  const rows = workspaceToRows(current);
  assert.equal(rows.filter(row => row.rowType === 'links').length, 2);
  assert.ok(rows.every(isWorkspaceMetadataRow));
  assert.deepEqual(workspaceFromRows([...rows].reverse(), [], 11), { ...current, items: [...current.items].reverse() });
  assert.equal(isWorkspaceMetadataRow({ id: 'original_document', storageName: 'safe-original.pdf' }), false);
  assert.equal(isWorkspaceMetadataRow({ id: '__workspace_unrecognized' }), true);
  assert.deepEqual(workspaceFromRows([], [], 4), emptyWorkspace(4));
  const malformed = [
    rows.filter(row => row.id !== '__workspace_meta_v1'),
    rows.filter(row => row.id !== '__workspace_links_1'),
    [...rows, structuredClone(rows[1])],
    rows.map(row => row.id === '__workspace_links_1' ? { ...row, id: '__workspace_links_2' } : row),
    rows.map(row => row.id === '__workspace_item_idea_0' ? { ...row, item: { ...row.item, id: 'foreign_id' } } : row),
    [...rows, { id: 'foreign_original', rowKind: 'introduce-me-workspace', schemaVersion: 1, rowType: 'document', storageName: 'foreign.pdf' }],
  ];
  for (const forged of malformed) assert.throws(() => workspaceFromRows(forged, [], 11), badRequest);
});
