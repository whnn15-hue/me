import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
async function load() {
  const out = await build({ entryPoints: ['src/free/evidence-approval.ts'], absWorkingDir: root, bundle: true, platform: 'node', format: 'esm', write: false });
  const dir = await mkdtemp(join(tmpdir(), 'title-match-')); const file = join(dir, 'approval.mjs');
  await writeFile(file, out.outputFiles[0].contents);
  try { return await import(pathToFileURL(file).href); } finally { await rm(dir, { recursive: true, force: true }); }
}
const career = (id, title, startDate) => ({ id, title, startDate, organization: '', documentIds: [] });
const prepared = (careers, extra = {}) => ({
  format: 'career-evidence-import', version: 1, newCareerIds: [], careers,
  documents: [{ id: 'doc_a', recordIds: [careers[0]?.id].filter(Boolean) }, { id: 'doc_b', recordIds: [careers[0]?.id].filter(Boolean) }], ...extra,
});
const archived = career('archive_only_id', '수요연수회: 에듀테크 관련', '2022-09-28');

test('title-match approval attaches to the single same-title career of that year', async () => {
  const { automaticEvidencePlan } = await load();
  const live = [career('live_1', '수요연수회:에듀테크 관련', '2022'), career('live_2', '수요연수회: 에듀테크 관련', '2023-05-01'), career('live_3', '다른 연수', '2022-09-28')];
  const plan = automaticEvidencePlan(prepared([archived]), live, false, false, false, true);
  assert.deepEqual(plan, { links: { doc_a: ['live_1'], doc_b: ['live_1'] }, newCareerIds: [] });
  // Full-width punctuation still matches.
  assert.deepEqual(automaticEvidencePlan(prepared([archived]), [career('fw', '수요연수회： 에듀테크 관련', '2022-09-01')], false, false, false, true).links.doc_a, ['fw']);
});

test('title-match approval stops on ambiguity, absence or broader requests', async () => {
  const { automaticEvidencePlan } = await load();
  const one = [career('live_1', '수요연수회: 에듀테크 관련', '2022-09-28')];
  assert.equal(automaticEvidencePlan(prepared([archived]), [...one, career('live_x', '수요연수회: 에듀테크 관련', '2022-10-05')], false, false, false, true), null, 'two candidates');
  assert.equal(automaticEvidencePlan(prepared([archived]), [career('live_y', '수요연수회: 에듀테크 관련', '2021-09-28')], false, false, false, true), null, 'other year');
  assert.equal(automaticEvidencePlan(prepared([archived]), [], false, false, false, true), null, 'missing');
  assert.equal(automaticEvidencePlan(prepared([{ ...archived, startDate: '' }]), one, false, false, false, true), null, 'no archived year');
  assert.equal(automaticEvidencePlan(prepared([archived], { newCareerIds: ['archive_only_id'] }), one, false, false, false, true), null, 'cannot create');
  assert.equal(automaticEvidencePlan(prepared([archived]), one, true, false, false, true), null, 'cannot combine with new careers');
  assert.equal(automaticEvidencePlan(prepared([archived]), one, false, true, false, true), null, 'cannot combine with details');
  assert.equal(automaticEvidencePlan(prepared([archived]), one, false, false, true, true), null, 'cannot combine with document-only');
  assert.equal(automaticEvidencePlan(prepared([archived]), one), null, 'without the approval an unknown ID never matches by title');
  assert.equal(automaticEvidencePlan(prepared([]), one, false, false, false, true), null, 'documents must name a career');
});
