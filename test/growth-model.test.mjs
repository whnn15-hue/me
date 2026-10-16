import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({entryPoints:['src/growth/growth-model.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {growthModel,seoulToday}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const career=(id,startDate,fields={})=>({id,title:id,category:'강의·연수',organization:'가상 연수원',startDate,endDate:'',role:'강사',description:'',tags:[],documentIds:[],...fields});

test('growth counts start years once, keeps gaps, excludes future and undated entries, and never mutates records',()=>{
  const careers=[career('span','2021',{endDate:'2026'}),career('same-year','2021-05'),career('current','2026-10-16'),career('future','2026-10-17'),career('next','2027'),career('unknown','')];
  const original=structuredClone(careers), model=growthModel(careers,[],'2026-10-16');
  assert.deepEqual(model.series.map(({year,count,cumulative})=>({year,count,cumulative})),[
    {year:2021,count:2,cumulative:2},{year:2022,count:0,cumulative:2},{year:2023,count:0,cumulative:2},{year:2024,count:0,cumulative:2},{year:2025,count:0,cumulative:2},{year:2026,count:1,cumulative:3},
  ]);
  assert.equal(model.total,3);assert.equal(model.future.length,2);assert.equal(model.unknown.length,1);
  assert.equal(model.categories.reduce((sum,row)=>sum+row.count,0),careers.length);
  assert.equal(model.organizations,1);assert.deepEqual(careers,original);
});

test('growth handles empty data and sparse extreme years without thousands of controls',()=>{
  const empty=growthModel([],[],'2026-10-16');assert.equal(empty.total,0);assert.deepEqual(empty.categories,[]);assert.deepEqual(empty.series,[{year:2026,count:0,cumulative:0,records:[]}]);
  const sparse=growthModel([career('ancient','0100'),career('new','2026')],[],'2026-10-16');assert.deepEqual(sparse.series.map(row=>row.year),[100,2026]);assert.equal(sparse.series.at(-1).cumulative,2);
});

test('growth uses the current Korean date across the UTC day boundary',()=>{
  assert.equal(seoulToday(new Date('2026-10-15T15:01:00Z')),'2026-10-16');
});
