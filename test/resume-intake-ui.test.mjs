import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const result = await build({
  absWorkingDir: root, bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', outfile: 'fixture.js',
  stdin: { loader: 'tsx', resolveDir: root, contents: `
    import {createRoot} from 'react-dom/client';
    import ResumeBuilder, {recommendResumeCareers, suggestResumeMappings} from './src/ResumeBuilder';
    const records = [
      {id:'lecture',title:'영상 제작 강사',category:'강의·연수',organization:'가상교육원',role:'강사',startDate:'2025-06-01',endDate:'',description:'저장된 강의 설명',tags:['미디어'],documentIds:['proof']},
      {id:'award',title:'수학 연구대회 입상',category:'연구·수상',organization:'가상연구원',role:'',startDate:'2024-11-01',endDate:'',description:'저장된 연구 설명',tags:['수학'],documentIds:[]},
    ];
    globalThis.fixture={calls:[],errors:[],toasts:[],records, saved:[]};
    globalThis.fixture.recommend=(request)=>recommendResumeCareers(records,request);
    globalThis.fixture.map=(fields,values)=>suggestResumeMappings(fields,values);
    createRoot(document.getElementById('root')).render(<ResumeBuilder careers={records} documents={[{id:'proof'}]} onError={e=>fixture.errors.push(e.message)} onToast={text=>fixture.toasts.push(text)} />);
  ` },
  plugins: [{name:'private-resume-fixture',setup(builder){
    builder.onResolve({filter:/^\.\/api$/},({importer})=>importer.endsWith('/ResumeBuilder.tsx')?{path:'api',namespace:'fixture'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`
      export async function api(path,options){
        fixture.calls.push({path,name:options.body.get('file').name});
        return {fields:[
          {id:'name',text:'{{이름}}',label:'이름',editable:true},
          {id:'career',text:'{{경력}}',label:'경력',editable:true},
          {id:'label',text:'성명',label:'성명',editable:true},
          {id:'blank',text:'',label:'빈 셀',editable:true},
          {id:'locked',text:'{{경력}}',label:'고정 칸',editable:false},
        ],warnings:[]};
      }
      export async function download(path,name,options){fixture.calls.push({path,name,body:typeof options.body==='string'?JSON.parse(options.body):{mappings:JSON.parse(options.body.get('mappings'))}});}
      export async function saveBlob(blob,name){fixture.saved.push({name,text:await blob.text()});}
    `}));
  }}],
});
const javascript = result.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css = ['styles.css','resume-intake.css'].map(file=>readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8')).join('\n');
const browserOptions={skip:!existsSync(chromiumPath)&&!existsSync(chromium.executablePath())};

async function fixture(run){
  const server=createServer((request,response)=>{
    if(request.url==='/fixture.js') return response.writeHead(200,{'Content-Type':'application/javascript'}).end(javascript);
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<style>${css}body{padding:25px}#root{max-width:1250px;margin:auto}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  let browser;
  const errors=[], external=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1400,height:1000}});
    page.setDefaultTimeout(5000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      external.push(route.request().url());return route.abort();
    });
    await page.goto(origin);
    await page.getByRole('heading',{name:'어떤 서류를 만들까요?'}).waitFor();
    await run(page);
    assert.deepEqual(errors,[]);
    assert.deepEqual(external,[]);
    assert.equal(await page.evaluate(()=>localStorage.length),0);
  } finally {
    await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}

test('resume recommendations and automatic mappings use facts and explicit editable placeholders only',browserOptions,async()=>{
  await fixture(async page=>{
    assert.deepEqual(await page.evaluate(()=>fixture.recommend('이력서 양식')),[]);
    assert.deepEqual(await page.evaluate(()=>fixture.recommend('미디어교육 강사')),['lecture']);
    const mappings=await page.evaluate(()=>fixture.map([
      {id:'label',text:'성명',editable:true},{id:'blank',text:'',editable:true},
      {id:'known',text:'이름: {{이름}}, 연락처: [[연락처]]',editable:true},
      {id:'locked',text:'{{이름}}',editable:false},{id:'unknown',text:'{{주소}}',editable:true},
    ],{이름:'가상 이름',연락처:''}));
    assert.deepEqual(mappings,{known:'이름: 가상 이름, 연락처: [[연락처]]'});
    assert.equal(await page.locator('.resume-career-list').count(),0);
    await page.getByLabel('이력서 양식 선택').setInputFiles({name:'지원서.hwp',mimeType:'application/octet-stream',buffer:Buffer.from('fixture')});
    assert.match(await page.evaluate(()=>fixture.errors[0]),/HWPX/);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
  });
});

test('HWPX intake recommends records, preserves labels and unsupported cells, and allows stable manual editing',browserOptions,async()=>{
  await fixture(async page=>{
    await page.getByLabel('이력서 양식 선택').setInputFiles({name:'미디어교육 강사.hwpx',mimeType:'application/zip',buffer:Buffer.from('fixture')});
    await page.getByRole('heading',{name:'양식에 담을 내용'}).waitFor();
    assert.equal(await page.locator('.resume-career.selected').count(),1);
    assert.match(await page.locator('.resume-filled-fields').innerText(),/영상 제작 강사/);
    await page.getByRole('button',{name:'작성한 HWPX 받기'}).click();
    let mapping=await page.evaluate(()=>fixture.calls.at(-1).body.mappings);
    assert.deepEqual(Object.keys(mapping),['career']);
    await page.getByText('제목과 인적 사항',{exact:true}).click();
    await page.getByPlaceholder('이름 입력').fill('가상 이름');
    await page.getByRole('button',{name:'선택 내용으로 채우기'}).click();
    await page.locator('.resume-manual-fields > summary').click();
    await page.getByLabel('칸 4 입력 내용',{exact:true}).pressSequentially('수동 입력 내용');
    assert.equal(await page.getByLabel('칸 4 입력 내용',{exact:true}).inputValue(),'수동 입력 내용');
    assert.equal(await page.getByLabel('입력할 양식 칸').locator('option[value="locked"]').evaluate(option=>option.disabled),true);
    await page.getByRole('button',{name:'작성한 HWPX 받기'}).click();
    mapping=await page.evaluate(()=>fixture.calls.at(-1).body.mappings);
    assert.equal(mapping.name,'가상 이름');assert.equal(mapping.blank,'수동 입력 내용');
    assert.equal(mapping.label,undefined);assert.equal(mapping.locked,undefined);
    await page.getByRole('button',{name:'증빙 ZIP 받기'}).click();
    assert.deepEqual(await page.evaluate(()=>fixture.calls.at(-1).body),{careerIds:['lecture']});
    assert.equal(await page.evaluate(()=>fixture.records[0].title),'영상 제작 강사');
  });
});

test('record-first path retains preview, CSV and evidence export without storing profile inputs',browserOptions,async()=>{
  await fixture(async page=>{
    await page.getByRole('button',{name:/이력으로 만들기/}).click();
    await page.locator('.resume-career').first().click();
    assert.match(await page.locator('.resume-paper').innerText(),/영상 제작 강사/);
    await page.getByRole('button',{name:'CSV',exact:true}).click();
    await page.waitForFunction(()=>fixture.saved.length===1);
    const saved=await page.evaluate(()=>fixture.saved[0]);
    assert.match(saved.text,/증빙 서류/);assert.match(saved.text,/있음/);
    assert.doesNotMatch(saved.text,/수학 연구대회 입상/);
    await page.getByRole('button',{name:'증빙 ZIP 받기'}).click();
    assert.deepEqual(await page.evaluate(()=>fixture.calls.at(-1).body),{careerIds:['lecture']});
  });
});
