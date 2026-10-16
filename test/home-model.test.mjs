import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({entryPoints:['src/home/home-model.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {homeModel,isExactDate}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const career=(id,startDate)=>({id,title:id,category:'강의·연수',organization:'연수원',startDate,endDate:'',role:'강사',description:'',tags:[],documentIds:[]});
const item=(id,kind,fields={})=>({id,kind,title:id,tags:[],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',...fields});

test('home agenda requires real full dates, excludes submitted work, preserves overdue tasks and never changes source data',()=>{
  const careers=[career('year','2027'),career('month','2026-11'),career('invalid','2026-02-30'),career('past','2026-10-16'),career('today','2026-10-17'),career('next','2026-10-18')];
  const workspace={items:[item('course','course'),item('overdue','assignment',{dueDate:'2026-10-16',status:'in-progress',courseId:'course'}),item('submitted','assignment',{dueDate:'2026-10-18',status:'submitted'}),item('no-date','assignment',{dueDate:'',status:'planned'}),item('active','project',{startDate:'2026-10-01',endDate:'2026-10-17'}),item('ended','project',{startDate:'2026-09-01',endDate:'2026-10-16'})],links:[]};
  const original=structuredClone({careers,workspace});
  const model=homeModel(careers,[],workspace,'2026-10-17');
  assert.deepEqual(model.agenda.map(row=>row.ref),['assignment:overdue','career:today','career:next']);
  assert.equal(model.agenda[0].overdue,true);assert.equal(model.agenda[0].detail,'course');
  assert.equal(model.assignments.length,2);assert.deepEqual(model.activeProjects.map(row=>row.id),['active']);
  assert.deepEqual({careers,workspace},original);
  assert.equal(isExactDate('2026-02-29'),false);assert.equal(isExactDate('2028-02-29'),true);
});

test('home recent work uses modification time and handles an empty archive',()=>{
  const workspace={items:[item('old','material'),item('new','paper',{updatedAt:'2026-10-17T00:00:00Z'}),item('course','course',{updatedAt:'2026-10-18T00:00:00Z'})],links:[]};
  assert.deepEqual(homeModel([],[],workspace,'2026-10-17').recent.map(row=>row.id),['new','old']);
  assert.deepEqual(homeModel([],[],{items:[],links:[]},'2026-10-17'),{agenda:[],assignments:[],activeProjects:[],recent:[],recentCareers:[]});
});
