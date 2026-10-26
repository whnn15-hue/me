import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({entryPoints:['src/career-overview-model.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {careerOverview}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const row=(id,fields={})=>({id,title:id,category:'강의·연수',organization:'가상 연수원',role:'강사',startDate:'2026',endDate:'',description:'',tags:[],documentIds:[],...fields});
test('overview includes future and undated records once, resolves legacy categories and preserves evidence identity',()=>{
  const careers=[row('span',{startDate:'2021',endDate:'2026',documentIds:['real','missing']}),row('future',{startDate:'2028'}),row('unknown',{startDate:''}),row('book',{category:'집필·콘텐츠',title:'학교폭력 자료집 집필',role:'집필위원'})];
  const before=structuredClone(careers), model=careerOverview(careers,[{id:'real',name:'증빙'}]);
  assert.equal(model.rows.length,4);assert.deepEqual(model.years,['2028','2026','2021','연도 미입력']);
  assert.equal(model.rows.find(x=>x.career.id==='span').evidence,1);assert.equal(model.rows.find(x=>x.career.id==='book').category,'집필');assert.deepEqual(careers,before);
});
test('overview searches institution, role, tags and award grade together',()=>{
  const careers=[row('award',{category:'연구대회',title:'가상 연구대회 본선',organization:'가상 교육청',awardGrade:'1등급',tags:['과학']}),row('lecture')];
  assert.equal(careerOverview(careers,[],'교육청 1등급 과학').rows.length,1);
  assert.equal(careerOverview(careers,[],'없는기관').rows.length,0);
  assert.deepEqual(careerOverview([],[]).years,[]);
});
