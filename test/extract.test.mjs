import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, ruleAnalysis } from '../server/extract.mjs';

test('specific awards and employment beat generic education terms in rule suggestions',()=>{
  assert.equal(ruleAnalysis('2024년 교육방송연구대회 시도1등급')[0].category,'연구대회');
  assert.equal(ruleAnalysis('2025년 한국교육학술정보원 파견근무 AI디지털교과서 교육 지원')[0].category,'파견');
  assert.equal(ruleAnalysis('2026년 교육 유공 장관 표창')[0].category,'표창');
  assert.equal(ruleAnalysis('2025년 디지털 미디어 리터러시 연수 강사')[0].category,'강의·연수');
});

test('untrusted AI fields are sanitized before a draft reaches the editor',async()=>{
  const payload={careers:[{title:'강의',category:'강의·연수',organization:{secret:'unexpected'},role:null,tags:[null,'교육',42,'교육'],startDate:'2025',datePrecision:'invalid',description:['not a string']}],warnings:[{},'날짜 확인']};
  const fetcher=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(payload)}}]}),{headers:{'Content-Type':'application/json'}});
  const result=await analyze({text:'2025년 교육 강의',apiKey:'test-only',fetcher});
  assert.equal(result.method,'ai');
  assert.deepEqual(result.careers[0].tags,['교육']);
  assert.equal(result.careers[0].organization,'');
  assert.equal(result.careers[0].description,'');
  assert.equal(result.careers[0].datePrecision,'year');
  assert.deepEqual(result.warnings,['날짜 확인']);
  payload.careers[0].startDate='2025-02-30';
  const invalid=await analyze({text:'2025년 교육 강의',apiKey:'test-only',fetcher});
  assert.equal(invalid.method,'rules');
  assert.ok(invalid.warnings.some(w=>w.includes('AI 분석에 실패')));
});
