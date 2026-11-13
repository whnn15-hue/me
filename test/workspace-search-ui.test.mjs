import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const browserOptions = { skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()) };
const bundle = await build({
  absWorkingDir: root,
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';
    import WorkspaceSearch from './src/workspace/WorkspaceSearch';
    import {normalizeWorkspace} from './shared/workspace.mjs';
    const stamp='2026-01-01T00:00:00.000Z';
    const workspace=normalizeWorkspace({schemaVersion:1,revision:0,links:[],items:[
      {id:'lesson',kind:'project',title:'검색검증 생태 수업',schoolYear:'2026',subjects:[{subject:'과학',unit:'생태계'}],tags:['공통'],createdAt:stamp,updatedAt:stamp},
      {id:'learning',kind:'material',title:'검색검증 생태 교안',purpose:'lecture',resourceType:'lecture',format:'PDF',summary:'관찰 기록을 수업에 활용',tags:['공통'],createdAt:stamp,updatedAt:stamp},
      {id:'video',kind:'material',title:'검색검증 배경음악',purpose:'lecture',resourceType:'music',format:'오디오',tags:['영상'],createdAt:stamp,updatedAt:stamp},
      {id:'classroom',kind:'material',title:'검색검증 학급 활동지',purpose:'classroom',resourceType:'lecture',format:'PDF',tags:['공통'],createdAt:stamp,updatedAt:stamp},
      {id:'school_lesson',kind:'material',title:'검색검증 수업 활동 파일',purpose:'classroom',schoolSection:'lesson',resourceType:'lecture',format:'PDF',tags:['공통'],createdAt:stamp,updatedAt:stamp},
      {id:'research',kind:'material',title:'검색검증 연구 보고서',purpose:'research',resourceType:'lecture',format:'PDF',researchType:'보고서',date:'2026-01-01',tags:['연구'],createdAt:stamp,updatedAt:stamp},
      {id:'hidden',kind:'course',title:'검색검증 숨긴 강좌',semester:'2026-1',tags:['공통'],createdAt:stamp,updatedAt:stamp}
    ]});
    const careers=[{id:'career',title:'검색검증 생태 연수',category:'강의·연수',organization:'가상 교육원',role:'강사',startDate:'2026-02-01',endDate:'',datePrecision:'day',description:'생태 주제 교원연수',tags:['공통'],documentIds:['proof'],evidenceStatus:'attached',verified:true}];
    const documents=[{id:'proof',name:'검색검증 증빙.pdf',mime:'application/pdf',size:12,createdAt:stamp,text:'토양 관찰 안내 공문',recordIds:['career']}];
    globalThis.fixture={events:[],original:JSON.stringify({workspace,careers,documents})};
    createRoot(document.getElementById('root')).render(<WorkspaceSearch workspace={workspace} careers={careers} documents={documents}
      onOpen={ref=>fixture.events.push({type:'open',ref})} onClose={()=>fixture.events.push({type:'close'})}/>);
    fixture.snapshot=()=>JSON.stringify({workspace,careers,documents});
  ` },
  bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', loader:{'.css':'empty'},
});

async function fixture(run) {
  const server=createServer((req,res)=>{
    if(req.url==='/bundle.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(bundle.outputFiles[0].text);
    if(req.url==='/fixture')return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<header class="topbar"><div id="root"></div></header><button id="outside">검색 밖으로</button><script src="/bundle.js"></script>');
    res.writeHead(404).end();
  });
  let browser;const errors=[],external=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
    await page.goto(origin+'/fixture');await page.getByRole('combobox',{name:'모든 기록 검색어',exact:true}).waitFor();
    await run(page);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    assert.equal(await page.evaluate(()=>fixture.snapshot()),await page.evaluate(()=>fixture.original),'Searching must not mutate stored data');
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

const input=page=>page.getByRole('combobox',{name:'모든 기록 검색어',exact:true});
const kinds=page=>page.getByRole('combobox',{name:'검색할 기록 종류',exact:true});
const titles=page=>page.locator('.global-search-result strong').allTextContents();

test('integrated search is an inline header field and exposes only search controls, never mutation shortcuts',browserOptions,async()=>{
  await fixture(async page=>{
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await input(page).getAttribute('aria-expanded'),'false');
    await input(page).focus();
    assert.equal(await input(page).getAttribute('aria-expanded'),'true');
    assert.equal(await input(page).evaluate(element=>element===document.activeElement),true);
    assert.equal(await page.locator('.global-search-result').count(),0);
    assert.equal(await page.getByText('검색어를 입력해 주세요.',{exact:true}).count(),1);
    for(const name of ['경력 추가','공문 업로드','이력서 만들기','홈으로'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0);
    await input(page).fill('    ');await input(page).press('Enter');
    assert.equal(await page.locator('.global-search-result').count(),0);assert.deepEqual(await page.evaluate(()=>fixture.events),[]);
    await input(page).fill('검색검증');assert.equal(await page.locator('.global-search-result').count(),8);
    assert.ok(!(await titles(page)).includes('검색검증 숨긴 강좌'));
    await input(page).fill('토양');assert.deepEqual(await titles(page),['검색검증 증빙.pdf']);
    await input(page).fill('검색검증 생태 연수');assert.equal((await titles(page))[0],'검색검증 생태 연수');
    await input(page).fill('');assert.equal(await page.locator('.global-search-result').count(),0);
  });
});

test('search filters keep teaching plans, video assets, classroom materials and research distinct',browserOptions,async()=>{
  await fixture(async page=>{
    await input(page).fill('검색검증');
    await kinds(page).selectOption('material');assert.deepEqual(await titles(page),['검색검증 생태 교안']);
    await kinds(page).selectOption('video');assert.deepEqual(await titles(page),['검색검증 배경음악']);
    await kinds(page).selectOption('research');assert.deepEqual(await titles(page),['검색검증 연구 보고서']);
    await kinds(page).selectOption('project');assert.deepEqual(new Set(await titles(page)),new Set(['검색검증 생태 수업','검색검증 학급 활동지','검색검증 수업 활동 파일']));
    await kinds(page).selectOption('lesson');assert.deepEqual(await titles(page),['검색검증 수업 활동 파일']);
    await kinds(page).selectOption('classroom');assert.deepEqual(await titles(page),['검색검증 학급 활동지']);
    await kinds(page).selectOption('all');
    await page.getByRole('combobox',{name:'통합 검색 태그',exact:true}).selectOption('영상');
    assert.deepEqual(await titles(page),['검색검증 배경음악']);
    await input(page).fill('');assert.deepEqual(await titles(page),['검색검증 배경음악'],'An explicit tag remains a valid search');
    await page.getByRole('combobox',{name:'통합 검색 태그',exact:true}).selectOption('');
    assert.equal(await page.locator('.global-search-result').count(),0);
  });
});

test('keyboard and pointer result opening close search once and open the selected record',browserOptions,async()=>{
  await fixture(async page=>{
    await input(page).fill('검색검증');await kinds(page).selectOption('material');
    await input(page).focus();await input(page).press('ArrowDown');await input(page).press('ArrowUp');await input(page).press('Enter');
    assert.deepEqual(await page.evaluate(()=>fixture.events),[{type:'close'},{type:'open',ref:'material:learning'}]);
    await page.evaluate(()=>fixture.events=[]);
    await input(page).focus();await kinds(page).selectOption('all');await input(page).fill('검색검증 생태 연수');
    const secondTitle=(await titles(page))[1];assert.equal(secondTitle,'검색검증 증빙.pdf');
    await input(page).focus();await input(page).press('ArrowDown');await input(page).press('ArrowUp');
    assert.equal(await page.locator('.global-search-result').first().getAttribute('aria-selected'),'true');
    await input(page).press('ArrowDown');await input(page).press('Enter');
    assert.deepEqual(await page.evaluate(()=>fixture.events),[{type:'close'},{type:'open',ref:'document:proof'}]);
    await page.evaluate(()=>fixture.events=[]);
    await input(page).focus();await kinds(page).selectOption('video');await input(page).fill('검색검증');
    await page.locator('.global-search-result').click();
    assert.deepEqual(await page.evaluate(()=>fixture.events),[{type:'close'},{type:'open',ref:'material:video'}]);
  });
});


test('inline search handles shortcut, dismissal and Korean IME without changing views',browserOptions,async()=>{
  await fixture(async page=>{
    await page.keyboard.press('Control+k');
    assert.equal(await input(page).evaluate(element=>element===document.activeElement),true);
    await input(page).fill('검색검증');
    await input(page).evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true})));
    assert.deepEqual(await page.evaluate(()=>fixture.events),[],'IME confirmation must not open a record');
    await kinds(page).focus();await kinds(page).press('Escape');
    assert.equal(await input(page).getAttribute('aria-expanded'),'false');
    assert.equal(await page.getByRole('listbox',{name:'검색 결과'}).count(),0);
    assert.equal(await input(page).evaluate(element=>element===document.activeElement),true);
    await page.evaluate(()=>fixture.events=[]);
    await page.getByRole('button',{name:'통합 검색 실행',exact:true}).click();
    assert.equal(await input(page).getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('.global-search-result').count(),8);
    await page.getByRole('button',{name:'검색 밖으로',exact:true}).click();
    assert.equal(await input(page).getAttribute('aria-expanded'),'false');
    await page.keyboard.press('Control+k');
    assert.equal(await input(page).getAttribute('aria-expanded'),'true');
    await page.getByRole('combobox',{name:'통합 검색 태그',exact:true}).focus();
    await page.getByRole('button',{name:'검색 밖으로',exact:true}).focus();
    assert.equal(await input(page).getAttribute('aria-expanded'),'false');
    assert.deepEqual(await page.evaluate(()=>fixture.events),[]);
    assert.equal(await page.getByRole('dialog').count(),0);
  });
});
