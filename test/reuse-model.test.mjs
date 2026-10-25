import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { emptyWorkspace, normalizeWorkspaceItem, normalizeWorkspace, mutateWorkspace, workspaceFromRows, workspaceToRows, mergeWorkspaceData, translateWorkspaceOriginals } from '../shared/workspace.mjs';
import previewApi from '../netlify/preview-functions/career-api.mjs';
import previewBackup from '../netlify/preview-functions/career-backup.mjs';

const bundle = await build({ entryPoints: ['src/reuse/model.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const model = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const photo = (id, tags = []) => normalizeWorkspaceItem({ id, kind: 'photo', title: id, tags, documentId: 'doc-' + id, sha256: 'a'.repeat(64), reviewed: false, star: 0 });
const submission = (id, photoId) => normalizeWorkspaceItem({ id, kind: 'submission', title: id, slots: [{ id: 'slot-one', title: '모둠 토의 사진', tags: ['토의', '모둠'], photoId, caption: '제출 당시 설명' }] });

test('new records round trip through existing rows and backups, keeping legacy fields unchanged', () => {
  const legacy = normalizeWorkspaceItem({ id: 'old-project', kind: 'project', title: '기존 수업', schoolYear: '2024', photos: [{ label: '기존 사진 링크', url: 'https://example.test/a.jpg' }] });
  const data = normalizeWorkspace({ ...emptyWorkspace(5), items: [legacy, photo('photo-a'), submission('entry-a', 'photo-a')], links: [{ from: 'project:old-project', to: 'submission:entry-a' }] });
  assert.deepEqual(workspaceFromRows(workspaceToRows(data), [], 5), data);
  assert.deepEqual(data.items[0], legacy);
  const result = mergeWorkspaceData(normalizeWorkspace({ ...emptyWorkspace(), items: [legacy] }), data, []);
  assert.equal(result.added.items, 2);
  assert.deepEqual(result.workspace.items[0], legacy);
});
test('submission references reject missing/duplicate photos and prevent deleting a used photo', () => {
  const image = photo('p');
  assert.throws(() => normalizeWorkspace({ ...emptyWorkspace(), items: [submission('s', 'missing')] }), /사진/);
  const entry = submission('s', 'p');
  assert.throws(() => normalizeWorkspaceItem({ ...entry, slots: [...entry.slots, { ...entry.slots[0], id: 'slot-two' }] }), /한 번/);
  const data = normalizeWorkspace({ ...emptyWorkspace(), items: [image, entry] });
  assert.throws(() => mutateWorkspace(data, { operation: 'delete', id: 'p', expectedRevision: 0 }, []), /사용 중/);
  const edited = mutateWorkspace(data, { operation: 'update', id: 'p', expectedRevision: 0, links: [], item: { ...image, caption: '나중 설명' } }, []);
  assert.equal(edited.items.find(row => row.id === 's').slots[0].caption, '제출 당시 설명');
  assert.throws(() => mutateWorkspace(edited, { operation: 'delete', id: 's', expectedRevision: 0 }, []), /변경/);
});
test('scene matching keeps reused photos eligible but never recommends unrelated starred images', () => {
  const photos = [photo('unrelated', ['실험']), photo('matched', ['토의', '모둠']), photo('partial', ['모둠'])];
  photos[0].star = 3;
  const slot = model.slotsFromBrief('모둠 토의 사진')[0];
  assert.deepEqual(model.rankPhotos(photos, slot).map(row => row.photo.id), ['matched', 'partial']);
  assert.deepEqual(model.rankPhotos(photos, slot, ['matched']).map(row => row.photo.id), ['partial']);
  const entries = [submission('first', 'matched'), { ...submission('second', 'matched'), status: 'submitted' }];
  assert.equal(model.photoUsage('matched', entries).length, 2);
  assert.equal(model.rankPhotos(photos, slot)[0].photo.id, 'matched');
  assert.deepEqual(model.slotsFromBrief('제출 마감일 12월 1일'), []);
  assert.equal(model.safeFilename('../../<사진>'), '_..__사진_');
});
test('preview function bundle refuses every API request and never runs a backup', async () => {
  const response = previewApi(new Request('https://example.test/api/data'));
  assert.equal(response.status, 403);
  assert.deepEqual(await previewBackup().json(), { ok: true, skipped: true, preview: true });
});
test('JSON restore remaps both photos and submitted files only to verified originals', () => {
  const entry = { ...submission('entry', 'p'), documentIds: ['old-report'] };
  const workspace = normalizeWorkspace({ ...emptyWorkspace(), items: [photo('p'), entry] });
  const translated = translateWorkspaceOriginals(workspace, (id, hash) => {
    if (id === 'doc-p' && hash === 'a'.repeat(64)) return 'current-photo';
    if (id === 'old-report') return 'current-report';
  });
  assert.equal(translated.items[0].documentId, 'current-photo');
  assert.deepEqual(translated.items[1].documentIds, ['current-report']);
  assert.equal(workspace.items[0].documentId, 'doc-p');
  assert.throws(() => translateWorkspaceOriginals(workspace, () => undefined), /원본/);
});
