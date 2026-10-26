import test from 'node:test';
import assert from 'node:assert/strict';
import { recordTags, materialDraft } from '../shared/material-classification.mjs';

test('material tags use meaningful topics without inventing identities or altering legacy data', () => {
  const item = { kind:'material', title:'우리반 스피치', tags:['직접 지정'], subjects:[], trainings:[], sourceFile:{name:'우리반_스피치.txt'}, author:'기존 저자', date:'2020-01-01', audience:['학생'], summary:'성명: 김가상\n이메일: example@example.com' };
  const before = structuredClone(item);
  const tags = recordTags(item);
  assert.deepEqual(item, before);
  for (const tag of ['직접 지정','국어','말하기','학급 운영','스피치']) assert.ok(tags.includes(tag));
  assert.ok(!tags.some(tag => /김가상|@|2020/.test(tag)));
});
test('project tags combine subjects and activities, keep manual tags first and respect capacity', () => {
  const base = {kind:'project', title:'분수 실험', subjects:[{subject:'수학',unit:'분수'}], activities:'모둠 토론', tags:['검토 완료']};
  assert.deepEqual(recordTags(base).slice(0,1), ['검토 완료']);
  assert.ok(recordTags(base).includes('수학')); assert.ok(recordTags(base).includes('토론'));
  const full = {...base,tags:Array.from({length:30},(_,i)=>`수동${i}`)};
  assert.deepEqual(recordTags(full),full.tags);
  assert.deepEqual(recordTags({kind:'paper',title:'수학 연구',tags:['보존']}),['보존']);
});
test('upload extraction and existing record suggestions both discover classroom topics', () => {
  const draft = materialDraft('속담.hwp','','classroom');
  assert.ok(draft.tags.includes('국어')); assert.ok(recordTags(draft).includes('어휘'));
  assert.deepEqual(recordTags({kind:'material',title:'일반 자료',tags:[]}),[]);
});
