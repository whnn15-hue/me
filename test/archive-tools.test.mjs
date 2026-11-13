import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints:['src/archive-tools.ts'], bundle:true, platform:'node', format:'esm', write:false });
const { matchesWords, rankSearch, archiveAttention, sortDocuments, documentFormat, careerEvidenceState, matchesEvidenceFilter } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('search handles Korean normalization, reordered words, case and legacy punctuation', () => {
  assert.equal(matchesWords('강의·연수 KERIS 디지털 교육', '교육 keris'), true);
  assert.equal(matchesWords('강의·연수', '강의, 연수'), true);
  assert.equal(matchesWords('국어'.normalize('NFD'), '국어'), true);
  assert.equal(matchesWords('디지털 교육', '교육 수학'), false);
});

test('title matches outrank metadata and document text without changing input', () => {
  const entries = [
    {title:'본문 자료',detail:'',body:'수학 연수'},
    {title:'교육 활동',detail:'수학 연수',body:''},
    {title:'수학 연수 자료',detail:'',body:''},
    {title:'수학 연수',detail:'',body:''},
    {title:'다른 자료',detail:'',body:''},
  ];
  const before = structuredClone(entries);
  assert.deepEqual(rankSearch(entries, '수학 연수').map(item=>item.title), ['수학 연수','수학 연수 자료','교육 활동','본문 자료']);
  assert.deepEqual(entries,before);
  assert.equal(rankSearch(entries,'').length,5);
  assert.deepEqual(rankSearch(entries,'없는 활동'),[]);
});

test('attention uses real files, respects evidence exemptions and canonical career links', () => {
  const careers = [
    {id:'a',documentIds:['present'],evidenceStatus:'attached',verified:true,startDate:'2026'},
    {id:'b',documentIds:['deleted-file'],evidenceStatus:'attached',verified:false,startDate:''},
    {id:'c',documentIds:[],evidenceStatus:'unneeded',verified:true,startDate:'2025-01'},
    {id:'d',documentIds:[],evidenceStatus:'unavailable',verified:true,startDate:'2025-01'},
  ];
  const documents = [{id:'present',recordIds:[]},{id:'unlinked',recordIds:['a']}];
  const before = structuredClone({careers,documents});
  const result = archiveAttention(careers,documents);
  for(const key of ['missing','undated']) assert.deepEqual(result[key].map(item=>item.id),['b']);
  assert.deepEqual(result.unlinked.map(item=>item.id),['unlinked']);
  assert.deepEqual({careers,documents},before);
  assert.deepEqual(archiveAttention([],[]),{missing:[],undated:[],unlinked:[]});
});

test('unavailable evidence is distinct from unneeded, reversible and overridden by a linked original', () => {
  const unavailable = {id:'u',documentIds:[],evidenceStatus:'unavailable',startDate:'2025'};
  const unneeded = {...unavailable,id:'n',evidenceStatus:'unneeded'};
  const restored = {...unavailable,id:'r',evidenceStatus:'later'};
  const attached = {...unavailable,documentIds:['file']};
  const before = structuredClone([unavailable,unneeded,restored,attached]);
  assert.equal(careerEvidenceState(unavailable,[]),'unavailable');
  assert.equal(matchesEvidenceFilter(unavailable,[],'증빙 확보 어려움'),true);
  assert.equal(matchesEvidenceFilter(unavailable,[],'증빙 미첨부'),false);
  assert.equal(matchesEvidenceFilter(unneeded,[],'증빙 확보 어려움'),false);
  assert.equal(matchesEvidenceFilter(unneeded,[],'증빙 불필요'),true);
  assert.equal(matchesEvidenceFilter(restored,[],'증빙 미첨부'),true);
  assert.equal(careerEvidenceState(attached,[{id:'file'}]),'attached');
  assert.equal(matchesEvidenceFilter(attached,[{id:'file'}],'증빙 확보 어려움'),false);
  assert.equal(matchesEvidenceFilter(attached,[{id:'file'}],'증빙 있음'),true);
  assert.deepEqual(archiveAttention([unavailable,unneeded,restored,attached],[{id:'file'}]).missing.map(item=>item.id),['r']);
  assert.deepEqual([unavailable,unneeded,restored,attached],before);
});

test('file grouping and sorting cover legacy originals and preserve source order', () => {
  assert.equal(documentFormat('한글.HWPX'),'문서');
  assert.equal(documentFormat('강좌.cell'),'스프레드시트');
  assert.equal(documentFormat('강의.PPTX'),'프레젠테이션');
  assert.equal(documentFormat('수업.html'),'HTML');
  assert.equal(documentFormat('공문.PDF'),'PDF');
  assert.equal(documentFormat('사진.jpeg'),'이미지');
  assert.equal(documentFormat('unknown'),'기타');
  const docs=[{id:'b',name:'나.pdf',size:10,createdAt:'2025-01-01'},{id:'a',name:'가.txt',size:20,createdAt:'2026-01-01'}];
  const before=structuredClone(docs);
  for(const order of ['recent','name','size']) assert.deepEqual(sortDocuments(docs,order).map(item=>item.id),['a','b']);
  assert.deepEqual(docs,before);
});
