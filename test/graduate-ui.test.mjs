import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const bundle = await build({
  absWorkingDir: root, bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'empty' },
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import GraduateView from './src/workspace/GraduateView';
    globalThis.fixture={data:null,errors:[],opens:[],seq:0,fail:false,saves:[],deletes:[]};
    const careers=[{id:'career-fixture',title:'가상 강의 활동',tags:['연구'],startDate:'2026',organization:'가상 기관',role:'강사'}];
    function Fixture(){
      const [workspace,setWorkspace]=useState({schemaVersion:1,items:[],links:[],revision:0});
      const [focusId,setFocusId]=useState('');
      globalThis.fixture.data=workspace;
      globalThis.fixture.bump=()=>setWorkspace(current=>({...current,revision:current.revision+1}));
      return <GraduateView workspace={workspace} careers={careers} focusId={focusId}
        onSave={async(item,links,expectedRevision)=>{
          globalThis.fixture.saves.push(expectedRevision);
          if(expectedRevision!==workspace.revision) throw new Error("다른 화면에서 기록이 변경되었습니다.");
          if(globalThis.fixture.fail) throw new Error('가상 저장 오류');
          const id=item.id || 'fixture-'+(++globalThis.fixture.seq), ref=item.kind+':'+id;
          const record={...item,id,createdAt:item.createdAt||'2026-10-13T00:00:00Z',updatedAt:'2026-10-13T00:00:00Z'};
          setWorkspace(current=>({...current,revision:current.revision+1,items:[...current.items.filter(x=>x.id!==id),record],links:[...current.links.filter(x=>x.from!==ref&&x.to!==ref),...links.map(to=>({from:ref,to}))]}));
        }}
        onDelete={async(id,expectedRevision)=>{ globalThis.fixture.deletes.push(expectedRevision); if(expectedRevision!==workspace.revision) throw new Error("다른 화면에서 기록이 변경되었습니다."); setWorkspace(current=>({...current,revision:current.revision+1,items:current.items.filter(item=>item.id!==id).map(item=>item.kind==='assignment'&&item.courseId===id?{...item,courseId:''}:item.kind==='paper'?{...item,courseIds:item.courseIds.filter(value=>value!==id)}:item),links:current.links.filter(link=>!link.from.endsWith(':'+id)&&!link.to.endsWith(':'+id))}));}}
        onError={error=>globalThis.fixture.errors.push(error.message)}
        onOpen={ref=>{globalThis.fixture.opens.push(ref);setFocusId(ref.split(':')[1]);}}/>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
});
const styles = ['../src/styles.css', '../src/workspace/Workspace.css', '../src/workspace/GraduateView.css'].map(path => {
  const url = new URL(path, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8').replace(/@import[^;]+;/g, '') : '';
}).join('\n');
async function fixture(run) {
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') return response.writeHead(200, { 'content-type': 'application/javascript' }).end(bundle.outputFiles[0].text);
    if (request.url === '/') return response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }).end(`<style>${styles}body{margin:20px}#root{max-width:1150px;margin:auto}</style><div id="root"></div><script src="/bundle.js"></script>`);
    response.writeHead(404).end();
  });
  let browser;
  const errors = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath: existsSync(executablePath) ? executablePath : undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
const browserOptions = { skip: !existsSync(executablePath) && !existsSync(chromium.executablePath()) };
const dialog = page => page.getByRole('dialog');
const close = page => dialog(page).getByRole('button', { name: '닫기', exact: true }).first().click();
const save = async page => { await dialog(page).getByRole('button', { name: '저장', exact: true }).click(); await dialog(page).waitFor({ state: 'hidden' }); };

test('graduate records support courses, deadlines, quotations, ideas, tags and reversible course links', browserOptions, async () => {
  await fixture(async page => {
    await page.getByRole('button', { name: '강좌 추가', exact: true }).first().click();
    await page.getByLabel('강좌명 *', { exact: true }).fill('가상 연구 방법');
    await page.getByLabel('학기', { exact: true }).fill('2026년 2학기');
    await page.getByLabel('교수명', { exact: true }).fill('가상 교수');
    await page.getByLabel('태그 추가', { exact: true }).fill('연구'); await page.getByLabel('태그 추가', { exact: true }).press('Enter');
    await page.getByRole('checkbox', { name: /가상 강의 활동/ }).check();
    await save(page);
    assert.equal(await page.locator('.grad-card').count(), 1);
    await page.getByRole('button', { name: '가상 연구 방법 상세 보기', exact: true }).click();
    assert.match(await dialog(page).innerText(), /가상 강의 활동/);
    await close(page);

    await page.getByRole('tab', { name: /과제/ }).click();
    for (const [title, date] of [['가상 늦은 과제', '2030-12-20'], ['가상 빠른 과제', '2030-10-10'], ['가상 미정 과제', '']]) {
      await page.getByRole('button', { name: '과제 추가', exact: true }).first().click();
      await page.getByLabel('과제명 *', { exact: true }).fill(title);
      await page.getByLabel('연결 강좌', { exact: true }).selectOption({ label: '가상 연구 방법 (2026년 2학기)' });
      if (date) await page.getByLabel('마감일', { exact: true }).fill(date);
      await page.getByLabel('상태', { exact: true }).selectOption('in-progress');
      await page.getByLabel('제출물 링크', { exact: true }).fill('https://drive.google.com/file/d/synthetic');
      await save(page);
    }
    assert.deepEqual(await page.locator('.grad-card h3').allTextContents(), ['가상 빠른 과제', '가상 늦은 과제', '가상 미정 과제']);
    await page.getByRole('button', { name: '가상 빠른 과제 수정', exact: true }).click();
    await page.getByLabel('상태', { exact: true }).selectOption('submitted'); await save(page);
    await page.getByLabel('과제 상태 필터', { exact: true }).selectOption('submitted');
    assert.deepEqual(await page.locator('.grad-card h3').allTextContents(), ['가상 빠른 과제']);
    await page.getByLabel('과제 상태 필터', { exact: true }).selectOption('');
    await page.getByLabel('과제 검색', { exact: true }).fill('연구 방법');
    assert.equal(await page.locator('.grad-card').count(), 3);

    await page.getByRole('tab', { name: /논문 노트/ }).click();
    await page.getByRole('button', { name: '논문 노트 추가', exact: true }).first().click();
    await page.getByLabel('제목 *', { exact: true }).fill('가상 학습 연구');
    await page.getByLabel('저자', { exact: true }).fill('가상 저자');
    await page.getByLabel('연도', { exact: true }).fill('2025');
    await page.getByLabel('핵심 내용 요약', { exact: true }).fill('협력과 반성을 다루는 가상 논문');
    await page.getByLabel('내 생각', { exact: true }).fill('실제 수업의 질문과 연결하기');
    await page.getByRole('button', { name: '인용문 추가', exact: true }).click();
    await page.getByLabel('인용문 1', { exact: true }).fill('가상 인용 문장');
    await page.getByLabel('쪽수 1', { exact: true }).fill('12-14');
    await page.locator('.grad-course-checks').getByRole('checkbox', { name: /가상 연구 방법/ }).check();
    await page.getByLabel('태그 추가', { exact: true }).fill('연구'); await page.getByLabel('태그 추가', { exact: true }).press('Enter');
    await save(page);
    await page.getByLabel('논문 노트 검색', { exact: true }).fill('가상 인용');
    assert.equal(await page.locator('.grad-card').count(), 1);
    await page.getByLabel('대학원 태그 필터', { exact: true }).selectOption('연구');
    await page.getByRole('button', { name: '가상 학습 연구 상세 보기', exact: true }).click();
    assert.match(await dialog(page).innerText(), /12-14쪽/);
    if (process.env.GRADUATE_SCREENSHOTS) await page.screenshot({path: process.env.GRADUATE_SCREENSHOTS + "/graduate-paper.png", fullPage:true});
    await dialog(page).getByRole('button', { name: '가상 연구 방법', exact: true }).click();
    await page.getByRole('dialog', { name: '가상 연구 방법', exact: true }).waitFor();
    assert.match(await dialog(page).innerText(), /과제: 가상 빠른 과제/);
    assert.match(await dialog(page).innerText(), /논문: 가상 학습 연구/);
    await close(page);
    await page.getByRole('button', { name: '가상 연구 방법 삭제', exact: true }).click();
    assert.match(await dialog(page).innerText(), /과제와 논문 노트는 그대로 남고/);
    await dialog(page).getByRole('button', { name: '삭제', exact: true }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    const state = await page.evaluate(() => fixture.data);
    assert.equal(state.items.filter(item => item.kind === 'assignment').length, 3);
    assert.ok(state.items.filter(item => item.kind === 'assignment').every(item => item.courseId === ''));
    assert.deepEqual(state.items.find(item => item.kind === 'paper').courseIds, []);

    await page.getByRole('tab', { name: /논문 주제 메모/ }).click();
    await page.getByRole('button', { name: '논문 주제 메모 추가', exact: true }).first().click();
    await page.getByLabel('제목 *', { exact: true }).fill('가상 질문');
    await page.getByLabel('자유 메모', { exact: true }).fill('협력 학습의 변화가 궁금하다.'); await save(page);
    await page.getByRole('button', { name: '가상 질문 수정', exact: true }).click();
    await page.getByLabel('자유 메모', { exact: true }).fill('질적 연구로 질문 좁히기'); await save(page);
    await page.getByLabel('논문 주제 메모 검색', { exact: true }).fill('질적 연구');
    assert.equal(await page.locator('.grad-card').count(), 1);
    await page.getByRole('button', { name: '가상 질문 삭제', exact: true }).click();
    await dialog(page).getByRole('button', { name: '삭제', exact: true }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => fixture.data.items)).filter(item => item.kind === 'idea').length, 0);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
    assert.doesNotMatch(await page.locator('body').innerText(), /\u00b7/);
  });
});

test('graduate editor retains changes on failed save and fits a phone viewport', browserOptions, async () => {
  await fixture(async page => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('tab', { name: /논문 주제 메모/ }).click();
    await page.getByRole('button', { name: '논문 주제 메모 추가', exact: true }).first().click();
    await page.getByLabel('제목 *', { exact: true }).fill('실패 후 유지할 제목');
    await page.getByLabel('자유 메모', { exact: true }).fill('작성 중인 메모');
    await page.evaluate(() => { fixture.fail = true; });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('자유 메모', { exact: true }).inputValue(), '작성 중인 메모');
    assert.equal(await page.evaluate(() => fixture.data.items.length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => { fixture.fail = false; }); await save(page);
    assert.equal(await page.locator('.grad-card').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.GRADUATE_SCREENSHOTS) await page.screenshot({path: process.env.GRADUATE_SCREENSHOTS + "/graduate-mobile.png", fullPage:true});
  });
});


test('graduate save and delete retain the revision captured when their dialog opened', browserOptions, async () => {
  await fixture(async page => {
    await page.getByRole('button', {name:'강좌 추가',exact:true}).first().click();
    await page.getByLabel('강좌명 *',{exact:true}).fill('가상 동시 편집 강좌');
    await save(page);
    await page.getByRole('button',{name:'가상 동시 편집 강좌 수정',exact:true}).click();
    await page.getByLabel('교수명',{exact:true}).fill('내 변경');
    await page.evaluate(()=>fixture.bump());
    for (let attempt=0; attempt<2; attempt++) {
      await dialog(page).getByRole('button',{name:'저장',exact:true}).click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(),/창을 닫고 최신 기록/);
    }
    assert.deepEqual(await page.evaluate(()=>fixture.saves),[0,1,1]);
    assert.equal(await page.getByLabel('교수명',{exact:true}).inputValue(),'내 변경');
    await dialog(page).getByRole('button',{name:'취소',exact:true}).click();
    await page.getByRole('button',{name:'가상 동시 편집 강좌 수정',exact:true}).click();
    await save(page);
    await page.getByRole('button',{name:'가상 동시 편집 강좌 삭제',exact:true}).click();
    await page.evaluate(()=>fixture.bump());
    await dialog(page).getByRole('button',{name:'삭제',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.deepEqual(await page.evaluate(()=>fixture.deletes),[3]);
    assert.equal(await page.evaluate(()=>fixture.data.items.length),1);
  });
});
