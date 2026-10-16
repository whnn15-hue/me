import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({entryPoints:['src/growth/growth-model.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {growthModel,calendarEntries,seoulToday,fullDate}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const career=(id,startDate,fields={})=>({id,title:id,category:'강의·연수',organization:'가상 연수원',startDate,endDate:'',role:'강사',description:'',tags:[],documentIds:[],...fields});
const workspace=items=>({schemaVersion:1,revision:0,links:[],items});

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

test('calendar respects date precision, leap days, and keeps assignments and lesson links distinct',()=>{
  const careers=[career('year','2026'),career('month','2026-10'),career('day','2026-10-16'),career('invalid','2026-02-30')];
  const data=workspace([{id:'lesson',kind:'project',title:'가상 수업',startDate:'2026-10-15'},{id:'task',kind:'assignment',title:'가상 과제',dueDate:'2026-10-17',status:'submitted'},{id:'partial-task',kind:'assignment',title:'월만 있는 과제',dueDate:'2026-10',status:'planned'}]);
  const original=structuredClone(data);
  assert.deepEqual(calendarEntries(careers,data).map(({ref,date,completed})=>({ref,date,completed})),[{ref:'project:lesson',date:'2026-10-15',completed:false},{ref:'career:day',date:'2026-10-16',completed:false},{ref:'assignment:task',date:'2026-10-17',completed:true}]);
  assert.equal(fullDate('2024-02-29'),true);assert.equal(fullDate('2025-02-29'),false);assert.equal(fullDate('2026-04-31'),false);assert.deepEqual(data,original);
  assert.equal(seoulToday(new Date('2026-10-15T15:01:00Z')),'2026-10-16');
});
