import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const browserOptions = { skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()) };
const output = await build({
  absWorkingDir: root, bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', outdir: '/tmp/materials-ui-fixture',
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import MaterialsView from './src/workspace/MaterialsView';
    const common={kind:'material',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};
    const initial={schemaVersion:1,revision:0,items:[
      {...common,id:'material_one',title:'가상 강의 자료',ownership:'created',author:'테스트 제작자',eventName:'가상 교원 연수',date:'2025-03-02',audience:['교원'],format:'PPT',fileUrl:'https://docs.google.com/presentation/d/fixture-one/edit',summary:'교원을 위한 가상 교육 실습',tags:['미디어','강의']},
      {...common,id:'material_two',title:'수집한 참고 자료',ownership:'collected',author:'가상 기관',eventName:'',date:'2024-06-01',audience:['학생'],format:'PDF',fileUrl:'https://drive.google.com/file/d/fixture-two/view',summary:'학생 활동에 참고하는 예시 자료',tags:['참고']},
      {id:'project_one',kind:'project',title:'가상 수업 프로젝트',tags:[],schoolYear:'2025',grade:'4학년'},
    ],links:[{from:'career:career_one',to:'material:material_one'}]};
    const careers=[{id:'career_one',title:'가상 강의 경력',category:'강의·연수',startDate:'2025',organization:'테스트 기관',role:'강사',tags:[]}];
    globalThis.fixture={saves:[],deletes:[],deleteRevisions:[],opens:[],errors:[],conflict:false};
    function Fixture(){
      const [workspace,setWorkspace]=useState(initial);
      globalThis.fixture.refreshWorkspace=revision=>setWorkspace(current=>({...current,revision}));
      return <MaterialsView workspace={workspace} careers={careers}
        onSave={async(item,links,expectedRevision)=>{
          globalThis.fixture.saves.push({item:JSON.parse(JSON.stringify(item)),links:[...links],expectedRevision});
          if(globalThis.fixture.conflict){
            setWorkspace(current=>({...current,revision:10,items:current.items.map(value=>value.id===item.id?{...value,title:'서버에서 바뀐 최신 제목'}:value)}));
            throw new Error('다른 화면에서 기록이 변경되었습니다. 최신 내용을 확인해 주세요.');
          }
          const saved={...item,id:item.id||'material_new',updatedAt:'2026-01-02T00:00:00.000Z'};
          const ref='material:'+saved.id;
          setWorkspace(current=>({...current,revision:current.revision+1,
            items:[...current.items.filter(value=>value.id!==saved.id),saved],
            links:[...current.links.filter(link=>link.from!==ref&&link.to!==ref),...links.map(to=>{const pair=[ref,to].sort();return {from:pair[0],to:pair[1]};})]}));
        }}
        onDelete={async(id,expectedRevision)=>{globalThis.fixture.deletes.push(id);globalThis.fixture.deleteRevisions.push(expectedRevision);setWorkspace(current=>({...current,items:current.items.filter(item=>item.id!==id),links:current.links.filter(link=>link.from!=='material:'+id&&link.to!=='material:'+id)}));}}
        onOpen={ref=>globalThis.fixture.opens.push(ref)} onError={error=>globalThis.fixture.errors.push(String(error))}/>
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
});

async function fixture(run) {
  const bundle = output.outputFiles.find(file => file.path.endsWith('.js')).text;
  const ownCss = output.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const sharedCssPath = new URL('../src/workspace/Workspace.css', import.meta.url);
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8') + (existsSync(sharedCssPath) ? readFileSync(sharedCssPath, 'utf8') : '') + ownCss;
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') return response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle);
    if (request.url === '/fixture') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<style>${styles}body{padding:24px}#root{max-width:1200px;margin:auto}@media(max-width:650px){body{padding:16px}}</style><div id="root"></div><script src="/bundle.js"></script>`);
    response.writeHead(404).end();
  });
  let browser;
  const errors = [], external = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: existsSync(chromiumPath) ? chromiumPath : undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(origin + '/fixture');
    await run(page);
    assert.deepEqual(errors, []);
    // Third-party fonts may be requested by the pre-existing global stylesheet;
    // no material documents or Drive APIs are ever fetched by this view.
    assert.ok(external.every(url => new URL(url).hostname === 'fonts.googleapis.com' || new URL(url).hostname === 'fonts.gstatic.com'));
  } finally {
    await browser?.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('material library filters ownership, audience, format, tags and search without fetching originals', browserOptions, async () => {
  await fixture(async page => {
    const cards = page.locator('.material-card');
    assert.equal(await cards.count(), 2);
    await page.getByRole('group', { name: '자료 구분 필터' }).getByRole('button', { name: /모아둔 자료/ }).click();
    assert.equal(await cards.count(), 1);
    assert.match(await cards.innerText(), /수집한 참고 자료/);
    await page.getByRole('button', { name: /필터 초기화/ }).click();
    await page.getByLabel('자료 대상 필터', { exact: true }).selectOption('교원');
    await page.getByLabel('자료 형식 필터', { exact: true }).selectOption('PPT');
    await page.getByLabel('자료 태그 필터', { exact: true }).selectOption('미디어');
    await page.getByLabel('강의 자료 검색', { exact: true }).fill('가상 교육 실습');
    assert.equal(await cards.count(), 1);
    assert.match(await cards.innerText(), /가상 강의 자료/);
    await page.getByLabel('강의 자료 검색', { exact: true }).fill('존재하지 않는 자료');
    await page.getByText('조건에 맞는 자료가 없어요', { exact: true }).waitFor();
    await page.getByRole('button', { name: /필터 초기화/ }).first().click();
    assert.equal(await cards.count(), 2);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.doesNotMatch(await page.locator('body').innerText(), /·/);
    assert.deepEqual(await page.evaluate(() => fixture.saves), []);
  });
});

test('material editor validates Drive links and saves complete fields with chosen career and project links', browserOptions, async () => {
  await fixture(async page => {
    await page.getByRole('button', { name: '자료 추가', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '강의 자료 추가', exact: true });
    await editor.waitFor();
    await editor.getByRole('group', { name: '자료 구분', exact: true }).getByRole('button', { name: '모아둔 자료', exact: true }).click();
    await editor.getByLabel('제목', { exact: false }).fill('새로운 가상 자료');
    await editor.getByLabel('제작자 또는 출처', { exact: true }).fill('가상 저자');
    await editor.getByLabel('사용한 행사 또는 강의', { exact: true }).fill('가상 워크숍');
    await editor.getByLabel('자료 날짜', { exact: true }).fill('2026-06-03');
    await editor.getByLabel('자료 형식', { exact: true }).selectOption('영상');
    await editor.getByLabel('대상', { exact: true }).fill('학생, 교원');
    await editor.getByLabel('핵심 내용과 활용 메모', { exact: true }).fill('프로젝트에서 다시 활용할 내용');
    await editor.getByLabel('태그 추가', { exact: true }).fill('수업 설계');
    await editor.getByLabel('태그 추가', { exact: true }).press('Enter');
    await editor.getByRole('checkbox', { name: /가상 강의 경력/ }).check();
    await editor.getByRole('checkbox', { name: /가상 수업 프로젝트/ }).check();
    const link = editor.getByLabel('구글 드라이브 파일 링크', { exact: false });
    await link.fill('https://evil.example/drive.google.com/file');
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await editor.getByRole('alert').waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.saves), []);
    await link.fill('https://drive.google.com/file/d/synthetic-new/view');
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => fixture.saves[0]);
    assert.deepEqual(saved.links.sort(), ['career:career_one', 'project:project_one']);
    assert.equal(saved.item.kind, 'material'); assert.equal(saved.item.ownership, 'collected');
    assert.equal(saved.item.title, '새로운 가상 자료'); assert.equal(saved.item.author, '가상 저자');
    assert.equal(saved.item.eventName, '가상 워크숍'); assert.equal(saved.item.date, '2026-06-03');
    assert.equal(saved.item.format, '영상'); assert.equal(saved.item.fileUrl, 'https://drive.google.com/file/d/synthetic-new/view');
    assert.deepEqual(saved.item.audience, ['학생', '교원']); assert.deepEqual(saved.item.tags, ['수업 설계']);
    assert.equal(saved.item.summary, '프로젝트에서 다시 활용할 내용');
    assert.equal(await page.locator('input[type=file]').count(), 0);
    await page.getByRole('button', { name: '새로운 가상 자료 상세보기', exact: true }).click();
    const detail = page.getByRole('dialog', { name: '새로운 가상 자료', exact: true });
    const open = detail.getByRole('link', { name: '드라이브에서 열기', exact: true });
    assert.equal(await open.getAttribute('href'), 'https://drive.google.com/file/d/synthetic-new/view');
    assert.equal(await open.getAttribute('target'), '_blank');
    assert.match(await open.getAttribute('rel'), /noopener/);
    await detail.getByRole('button', { name: /가상 수업 프로젝트/ }).click();
    assert.deepEqual(await page.evaluate(() => fixture.opens), ['project:project_one']);
    assert.deepEqual(await page.evaluate(() => fixture.errors), []);
  });
});

test('materials retain existing links when edited and require confirmation before deletion', browserOptions, async () => {
  await fixture(async page => {
    await page.getByRole('button', { name: '가상 강의 자료 상세보기', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '수정하기', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '강의 자료 수정', exact: true });
    await editor.getByLabel('제목', { exact: false }).fill('수정된 가상 자료');
    assert.equal(await editor.getByRole('checkbox', { name: /가상 강의 경력/ }).isChecked(), true);
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => fixture.saves[0].links), ['career:career_one']);
    let detail = page.getByRole('dialog', { name: '수정된 가상 자료', exact: true });
    await detail.waitFor();
    await detail.getByRole('button', { name: '삭제', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '강의 자료를 삭제할까요?', exact: true });
    await confirmation.waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.deletes), []);
    await confirmation.getByRole('button', { name: '취소', exact: true }).click();
    await detail.waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.deletes), []);
    await detail.getByRole('button', { name: '삭제', exact: true }).click();
    await confirmation.getByRole('button', { name: '자료 삭제', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => fixture.deletes), ['material_one']);
    assert.equal(await page.getByRole('button', { name: '수정된 가상 자료 상세보기', exact: true }).count(), 0);
    assert.equal(await page.locator('.material-card').count(), 1);
  });
});

test('material editor and delete confirmation retain their original revision through parent refreshes', browserOptions, async () => {
  await fixture(async page => {
    await page.getByRole('button', { name: '가상 강의 자료 상세보기', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '수정하기', exact: true }).click();
    let editor = page.getByRole('dialog', { name: '강의 자료 수정', exact: true });
    await editor.getByLabel('제목', { exact: false }).fill('사용자가 작성한 초안');
    await page.evaluate(() => { fixture.conflict = true; });
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await editor.getByRole('alert').waitFor();
    assert.equal(await editor.getByLabel('제목', { exact: false }).inputValue(), '사용자가 작성한 초안');
    assert.equal(await page.evaluate(() => fixture.saves[0].expectedRevision), 0);
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await page.waitForFunction(() => fixture.saves.length === 2);
    assert.deepEqual(await page.evaluate(() => fixture.saves.map(save => save.expectedRevision)), [0, 0]);
    await editor.getByRole('button', { name: '취소', exact: true }).click();
    const detail = page.getByRole('dialog', { name: '서버에서 바뀐 최신 제목', exact: true });
    await detail.waitFor();
    await detail.getByRole('button', { name: '수정하기', exact: true }).click();
    editor = page.getByRole('dialog', { name: '강의 자료 수정', exact: true });
    assert.equal(await editor.getByLabel('제목', { exact: false }).inputValue(), '서버에서 바뀐 최신 제목');
    await page.evaluate(() => { fixture.conflict = false; });
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => fixture.saves[2].expectedRevision), 10);
    await detail.getByRole('button', { name: '삭제', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '강의 자료를 삭제할까요?', exact: true });
    await confirmation.waitFor();
    await page.evaluate(() => fixture.refreshWorkspace(20));
    await confirmation.getByRole('button', { name: '자료 삭제', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => fixture.deleteRevisions), [11]);
  });
});
