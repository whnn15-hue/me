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
      {...common,id:'classroom_one',purpose:'classroom',title:'가상 스피치 활동',ownership:'created',author:'가상 교사',eventName:'아침 활동',date:'',audience:['학생'],format:'TXT',fileUrl:'https://drive.google.com/file/d/classroom-one/view',summary:'짝과 함께 발표하는 말하기 활동',tags:['학급운영','말하기']},
      {...common,id:'classroom_two',purpose:'classroom',title:'가상 속담 활동지',ownership:'collected',author:'가상 출처',eventName:'국어',date:'',audience:['학생'],format:'HWP',fileUrl:'https://drive.google.com/file/d/classroom-two/view',summary:'속담 뜻을 살펴보는 읽기 활동',tags:['국어']},
      {id:'project_one',kind:'project',title:'가상 수업 프로젝트',tags:[],schoolYear:'2025',grade:'4학년'},
    ],links:[{from:'career:career_one',to:'material:material_one'}]};
    const careers=[{id:'career_one',title:'가상 강의 경력',category:'강의·연수',startDate:'2025',organization:'테스트 기관',role:'강사',tags:[]}];
    globalThis.fixture={saves:[],deletes:[],deleteRevisions:[],opens:[],errors:[],conflict:false};
    function Fixture(){
      const [workspace,setWorkspace]=useState(initial);
      globalThis.fixture.refreshWorkspace=revision=>setWorkspace(current=>({...current,revision}));
      return <MaterialsView workspace={workspace} careers={careers}
        purpose={new URLSearchParams(location.search).get('purpose')==='classroom'?'classroom':'lecture'}
        importPanel={new URLSearchParams(location.search).get('purpose')==='classroom'?<p>가져오기 패널 위치</p>:undefined}
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

async function fixture(run, purpose = "lecture") {
  const bundle = output.outputFiles.find(file => file.path.endsWith('.js')).text;
  const ownCss = output.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const sharedCssPath = new URL('../src/workspace/Workspace.css', import.meta.url);
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8') + (existsSync(sharedCssPath) ? readFileSync(sharedCssPath, 'utf8') : '') + ownCss + readFileSync(new URL('../src/refinements.css',import.meta.url),'utf8') + readFileSync(new URL('../src/portfolio-library.css',import.meta.url),'utf8');
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') return response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle);
    if (request.url?.startsWith('/fixture?')) return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<style>${styles}body{padding:24px}#root{max-width:1200px;margin:auto}@media(max-width:650px){body{padding:16px}}</style><div id="root"></div><script src="/bundle.js"></script>`);
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
    await page.goto(origin + '/fixture?purpose=' + purpose);
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

test('material library filters subjects, trainings, format, tags and search without fetching originals', browserOptions, async () => {
  await fixture(async page => {
    const cards = page.locator('.material-card');
    assert.equal(await cards.count(), 2);
    await page.getByLabel('자료 태그 필터', {exact:true}).selectOption('참고');
    assert.equal(await cards.count(), 1);
    assert.match(await cards.innerText(), /수집한 참고 자료/);
    await page.getByRole('button', { name: /필터 초기화/ }).click();
    await page.getByLabel('자료 형식 필터', { exact: true }).selectOption('PPT');
    await page.getByLabel('자료 태그 필터', { exact: true }).selectOption('미디어');
    await page.getByLabel('자료실 검색', { exact: true }).fill('가상 교육 실습');
    assert.equal(await cards.count(), 1);
    assert.match(await cards.innerText(), /가상 강의 자료/);
    await page.getByLabel('자료실 검색', { exact: true }).fill('존재하지 않는 자료');
    await page.getByText('조건에 맞는 자료가 없어요', { exact: true }).waitFor();
    await page.getByRole('button', { name: /필터 초기화/ }).first().click();
    assert.equal(await cards.count(), 2);
    if (!process.env.TEST_DESKTOP_ONLY) await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.doesNotMatch(await page.locator('body').innerText(), /·/);
    assert.deepEqual(await page.evaluate(() => fixture.saves), []);
  });
});

test('material editor validates Drive links and saves simplified fields with chosen career and project links', browserOptions, async () => {
  await fixture(async page => {
    await page.getByRole('button', { name: '자료 추가', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '자료 추가', exact: true });
    await editor.waitFor();
    assert.equal(await editor.getByText('내가 만든 자료',{exact:true}).count(),0);
    if(await editor.locator('details.optional-fields:not([open])').count()) await editor.locator('details.optional-fields > summary').click();
    await editor.getByLabel('제목', { exact: false }).fill('새로운 가상 자료');
    await editor.getByLabel('자료 형식', { exact: true }).selectOption('영상');
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
    assert.equal(saved.item.kind, 'material'); assert.equal(saved.item.ownership, 'created');
    assert.equal(Object.hasOwn(saved.item, 'purpose'), false, 'legacy lecture shape stays unchanged');
    assert.equal(saved.item.title, '새로운 가상 자료'); assert.equal(saved.item.author, '');
    assert.equal(saved.item.eventName, ''); assert.equal(saved.item.date, '');
    assert.equal(saved.item.format, '영상'); assert.equal(saved.item.fileUrl, 'https://drive.google.com/file/d/synthetic-new/view');
    assert.deepEqual(saved.item.audience, []); assert.deepEqual(saved.item.tags, ['수업 설계', '영상']);
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
    const editor = page.getByRole('dialog', { name: '자료 수정', exact: true });
    await editor.getByLabel('제목', { exact: false }).fill('수정된 가상 자료');
    if(await editor.locator('details.optional-fields:not([open])').count()) await editor.locator('details.optional-fields > summary').click();
    assert.equal(await editor.getByRole('checkbox', { name: /가상 강의 경력/ }).isChecked(), true);
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => fixture.saves[0].links), ['career:career_one']);
    const kept = await page.evaluate(() => fixture.saves[0].item);
    assert.equal(kept.author, '테스트 제작자'); assert.equal(kept.date, '2025-03-02'); assert.deepEqual(kept.audience, ['교원']);
    let detail = page.getByRole('dialog', { name: '수정된 가상 자료', exact: true });
    await detail.waitFor();
    await detail.getByRole('button', { name: '삭제', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '자료를 삭제할까요?', exact: true });
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
    let editor = page.getByRole('dialog', { name: '자료 수정', exact: true });
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
    editor = page.getByRole('dialog', { name: '자료 수정', exact: true });
    assert.equal(await editor.getByLabel('제목', { exact: false }).inputValue(), '서버에서 바뀐 최신 제목');
    await page.evaluate(() => { fixture.conflict = false; });
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => fixture.saves[2].expectedRevision), 10);
    await detail.getByRole('button', { name: '삭제', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '자료를 삭제할까요?', exact: true });
    await confirmation.waitFor();
    await page.evaluate(() => fixture.refreshWorkspace(20));
    await confirmation.getByRole('button', { name: '자료 삭제', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => fixture.deleteRevisions), [11]);
  });
});


test('classroom library excludes lecture rows and filters HWP and TXT without exposing originals', browserOptions, async () => {
  await fixture(async page => {
    await page.getByRole('heading', { name: '학급 자료', exact: true }).waitFor();
    await page.getByText('준비된 자료 가져오기', {exact:true}).click();
    await page.getByText('가져오기 패널 위치', { exact: true }).waitFor();
    assert.equal(await page.locator('.material-card').count(), 2);
    assert.equal(await page.getByRole('button', { name: '가상 강의 자료 상세보기', exact: true }).count(), 0);
    await page.getByLabel('자료 형식 필터', { exact: true }).selectOption('TXT');
    await page.getByLabel('학급 자료 검색', { exact: true }).fill('말하기');
    assert.equal(await page.locator('.material-card').count(), 1);
    assert.match(await page.locator('.material-card').innerText(), /가상 스피치 활동/);
    await page.getByRole('button', { name: /필터 초기화/ }).first().click();
    await page.getByLabel('자료 형식 필터', { exact: true }).selectOption('HWP');
    assert.equal(await page.locator('.material-card').count(), 1);
    assert.match(await page.locator('.material-card').innerText(), /가상 속담 활동지/);
    if (!process.env.TEST_DESKTOP_ONLY) await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.doesNotMatch(await page.locator('body').innerText(), /·/);
    assert.deepEqual(await page.evaluate(() => fixture.saves), []);
  }, 'classroom');
});

test('classroom additions retain purpose through editing, link to lesson records and delete only their own row', browserOptions, async () => {
  await fixture(async page => {
    await page.getByRole('button', { name: '자료 추가', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '학급 자료 추가', exact: true });
    if(await editor.locator('details.optional-fields:not([open])').count()) await editor.locator('details.optional-fields > summary').click();
    await editor.getByLabel('제목', { exact: false }).fill('새 학급 활동');
    await editor.getByLabel('자료 형식', { exact: true }).selectOption('HWP');
    await editor.getByRole('checkbox', { name: /가상 수업 프로젝트/ }).check();
    await editor.getByLabel('구글 드라이브 파일 링크', { exact: false }).fill('https://drive.google.com/file/d/classroom-new/view');
    await editor.getByRole('button', { name: '자료 저장', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => fixture.saves[0]);
    assert.equal(saved.item.purpose, 'classroom');
    assert.equal(saved.item.format, 'HWP');
    assert.equal(saved.item.eventName, '');
    assert.deepEqual(saved.links, ['project:project_one']);
    assert.equal(saved.expectedRevision, 0);
    assert.equal(await page.locator('.material-card').count(), 3);
    await page.getByRole('button', { name: '새 학급 활동 상세보기', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '수정하기', exact: true }).click();
    const edit = page.getByRole('dialog', { name: '학급 자료 수정', exact: true });
    await edit.getByLabel('제목', { exact: false }).fill('수정한 학급 활동');
    await edit.getByRole('button', { name: '자료 저장', exact: true }).click();
    await edit.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => fixture.saves[1].item.purpose), 'classroom');
    assert.deepEqual(await page.evaluate(() => fixture.saves[1].links), ['project:project_one']);
    await page.getByRole('dialog', { name: '수정한 학급 활동', exact: true }).getByRole('button', { name: '삭제', exact: true }).click();
    await page.getByRole('dialog', { name: '학급 자료를 삭제할까요?', exact: true }).getByRole('button', { name: '자료 삭제', exact: true }).click();
    await page.waitForFunction(() => fixture.deletes.length === 1);
    assert.deepEqual(await page.evaluate(() => fixture.deletes), ['material_new']);
    assert.equal(await page.locator('.material-card').count(), 2);
  }, 'classroom');
});

test('gallery, list and favorite actions keep career links on desktop',browserOptions,async()=>{
  await fixture(async page=>{
    await page.getByRole('button',{name:'가상 강의 자료 즐겨찾기',exact:true}).click();
    const saved=await page.evaluate(()=>fixture.saves.at(-1));
    assert.equal(saved.item.favorite,true);assert.deepEqual(saved.links,['career:career_one']);assert.equal(saved.expectedRevision,0);
    await page.getByRole('button',{name:'즐겨찾는 자료만',exact:true}).click();
    assert.equal(await page.locator('.material-card').count(),1);
    await page.getByRole('button',{name:'목록 보기',exact:true}).click();
    assert.ok(await page.locator('.materials-grid').evaluate(element=>element.classList.contains('library-list')));
    if (!process.env.TEST_DESKTOP_ONLY) await page.setViewportSize({width:375,height:812});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await page.getByRole('link',{name:'가상 강의 자료 원본 열기'}).getAttribute('target'),'_blank');
    await page.getByRole('button',{name:'가상 강의 자료 즐겨찾기',exact:true}).click();
    assert.equal(await page.locator('.material-card').count(),0);
    await page.getByRole('button',{name:/필터 초기화/}).first().click();
    assert.equal(await page.locator('.material-card').count(),2);
    await page.reload();
    assert.equal(await page.getByRole('button',{name:'목록 보기',exact:true}).getAttribute('aria-pressed'),'true');
  });
});
