import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const bundle = await build({
  absWorkingDir: root,
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import ProjectsView from './src/workspace/ProjectsView';
    const emptyProject = {kind:'project',schoolYear:'2025',grade:'초등 4학년',startDate:'2025-04-01',endDate:'2025-04-03',subjects:[{subject:'사회',unit:'가상 마을'}],drivingQuestion:'학교 주변에는 어떤 이야기가 있을까?',lessonFlow:'탐구 후 나눔',activities:'가상 프로젝트 활동',tools:[],outputs:[],photos:[],reflection:'학생의 질문이 늘었음',tags:['마을'],createdAt:'2025-04-04',updatedAt:'2025-04-04'};
    const initial={schemaVersion:1,revision:0,items:[{...emptyProject,id:'project-a',title:'가상 마을 탐구'},{...emptyProject,id:'project-b',title:'가상 과학 수업',schoolYear:'2026',subjects:[{subject:'과학',unit:'생태계'}],tags:['생태']}],links:[]};
    const careers=[{id:'career-a',title:'가상 연수 강의',category:'강의·연수',organization:'테스트 기관',startDate:'2025',role:'강사',tags:[]}];
    globalThis.fixture={saved:[],saveRevisions:[],deleted:[],deleteRevisions:[],errors:[],opened:[],failNextSave:false};
    function Fixture(){
      const [workspace,setWorkspace]=useState(initial), [focusId,setFocusId]=useState(undefined);
      globalThis.fixture.setFocus=setFocusId;
      globalThis.fixture.advanceRevision=()=>setWorkspace(current=>({...current,revision:current.revision+5}));
      globalThis.fixture.state=workspace;
      globalThis.fixture.seed=(items,links=[])=>setWorkspace({schemaVersion:1,revision:0,items,links});
      return <ProjectsView workspace={workspace} careers={careers} focusId={focusId} onError={error=>fixture.errors.push(String(error))} onOpen={ref=>fixture.opened.push(ref)}
        onSave={async(item,links,expectedRevision)=>{fixture.saveRevisions.push(expectedRevision);if(fixture.failNextSave){fixture.failNextSave=false;setWorkspace(current=>({...current,revision:current.revision+1}));throw new Error('Synthetic conflict');} const saved={...item,id:item.id||'project-new',updatedAt:'2026-10-14'};fixture.saved.push({item:saved,links});setWorkspace(current=>({...current,revision:current.revision+1,items:[...current.items.filter(old=>old.id!==saved.id),saved],links:links.map(ref=>({from:'project:'+saved.id,to:ref}))}));}}
        onDelete={async(id,expectedRevision)=>{fixture.deleteRevisions.push(expectedRevision);fixture.deleted.push(id);setWorkspace(current=>({...current,revision:current.revision+1,items:current.items.filter(item=>item.id!==id),links:current.links.filter(link=>link.from!=='project:'+id&&link.to!=='project:'+id)}));}}/>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `},
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false,
  loader: {'.css':'empty'},
});
const browserOptions={skip:!existsSync(chromiumPath)&&!existsSync(chromium.executablePath())};
async function fixture(run){
  const styles=['styles.css','workspace/Workspace.css','workspace/ProjectsView.css'].map(file=>{
    const path=new URL('../src/'+file,import.meta.url);return existsSync(path)?readFileSync(path,'utf8'):'';
  }).join('\n');
  const server=createServer((request,response)=>{
    if(request.url==='/bundle.js') return response.writeHead(200,{'Content-Type':'application/javascript'}).end(bundle.outputFiles[0].text);
    if(request.url==='/fixture') return response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<style>'+styles+'</style><div id="root" style="padding:20px;max-width:1200px;margin:auto"></div><script src="/bundle.js"></script>');
    response.writeHead(404).end();
  });
  let browser;const pageErrors=[],externalRequests=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});
    const page=await browser.newPage();page.setDefaultTimeout(6000);
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      // Ignore pre-existing Google font CSS; photo requests remain observable.
      if(!route.request().url().includes('fonts.googleapis.com'))externalRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin+'/fixture');await run(page,externalRequests);assert.deepEqual(pageErrors,[]);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('project filters and editor preserve structured fields, relationships, and failed-save input',browserOptions,async()=>{
  await fixture(async page=>{
    await page.getByLabel('학년도 필터',{exact:true}).selectOption('2026');
    assert.equal(await page.getByRole('button',{name:'가상 마을 탐구 자세히 보기'}).count(),0);
    assert.equal(await page.getByRole('button',{name:'가상 과학 수업 자세히 보기'}).count(),1);
    await page.getByRole('button',{name:'필터 초기화'}).click();
    await page.getByLabel('교과 필터',{exact:true}).selectOption('사회');
    await page.getByLabel('태그 필터',{exact:true}).selectOption('마을');
    await page.getByLabel('수업 검색').fill('마을');
    assert.equal(await page.getByRole('button',{name:'가상 과학 수업 자세히 보기'}).count(),0);
    await page.getByRole('button',{name:'필터 초기화'}).click();
    await page.getByRole('button',{name:'수업 추가',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('수업 제목').fill('새로운 합성 수업');
    await dialog.getByLabel('학년도',{exact:true}).fill('2026');
    await dialog.getByLabel('학년',{exact:true}).fill('초등 5학년');
    await dialog.getByLabel('시작일',{exact:true}).fill('2026-05-02');
    await dialog.getByLabel('종료일',{exact:true}).fill('2026-05-01');
    await dialog.getByRole('button',{name:'수업 저장',exact:true}).click();
    assert.match(await dialog.getByRole('alert').innerText(),/종료일이 시작일보다/);
    assert.equal(await page.evaluate(()=>fixture.saved.length),0);
    await dialog.getByLabel('종료일',{exact:true}).fill('2026-05-04');
    await dialog.getByRole('button',{name:'교과 추가',exact:true}).click();
    await dialog.getByLabel('교과 1',{exact:true}).fill('국어');
    await dialog.getByLabel('단원 1',{exact:true}).fill('이야기 나누기');
    await dialog.getByRole('button',{name:'교과 추가',exact:true}).click();
    await dialog.getByLabel('교과 2',{exact:true}).fill('미술');
    await dialog.getByLabel('단원 2',{exact:true}).fill('그림 표현');
    if(await dialog.locator('details.optional-fields:not([open])').count()) await dialog.locator('details.optional-fields > summary').click();
    await dialog.getByLabel('핵심 질문').fill('질문을 그림으로 표현할 수 있을까?');
    await dialog.getByLabel('수업 흐름').fill('질문 → 그림 → 나눔');
    await dialog.getByLabel('주요 활동').fill('학생이 질문과 그림을 연결한다.');
    await dialog.getByLabel('활용 도구').fill('도구 A, 도구 B, 도구 A');
    await dialog.getByLabel('수업 성찰').fill('다음에는 학생이 질문을 선택하게 한다.');
    await dialog.getByRole('button',{name:'결과물 추가',exact:true}).click();
    await dialog.getByLabel('결과물 제목 1',{exact:true}).fill('작품 모음');
    await dialog.getByLabel('결과물 주소 1',{exact:true}).fill('https://example.test/result');
    await dialog.getByRole('button',{name:'사진 링크 추가',exact:true}).click();
    await dialog.getByLabel('사진 제목 1',{exact:true}).fill('활동 장면');
    await dialog.getByLabel('사진 주소 1',{exact:true}).fill('http://example.test/photo.jpg');
    await dialog.getByRole('button',{name:'수업 저장',exact:true}).click();
    assert.match(await dialog.getByRole('alert').innerText(),/https:\/\//);
    await dialog.getByLabel('사진 주소 1',{exact:true}).fill('https://example.test/photo.jpg');
    await dialog.getByLabel('태그 추가',{exact:true}).fill('통합수업');
    await dialog.getByRole('button',{name:'입력한 태그 추가'}).click();
    await dialog.getByRole('checkbox',{name:/가상 연수 강의/}).check();
    await page.evaluate(()=>fixture.failNextSave=true);
    await dialog.getByRole('button',{name:'수업 저장',exact:true}).click();
    assert.match(await dialog.getByRole('alert').innerText(),/입력한 내용은 유지/);
    assert.equal(await dialog.getByLabel('수업 성찰').inputValue(),'다음에는 학생이 질문을 선택하게 한다.');
    await dialog.getByRole('button',{name:'수업 저장',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(()=>fixture.saveRevisions),[0,0], 'open editor retains original revision after conflict refresh');
    const result=await page.evaluate(()=>fixture.saved[0]);
    assert.equal(result.item.title,'새로운 합성 수업');
    assert.deepEqual(result.item.subjects,[{subject:'국어',unit:'이야기 나누기'},{subject:'미술',unit:'그림 표현'}]);
    assert.deepEqual(result.item.tools,['도구 A','도구 B']);
    assert.deepEqual(result.item.tags,['통합수업']);
    assert.deepEqual(result.links,['career:career-a']);
    assert.equal(result.item.outputs[0].url,'https://example.test/result');
    assert.equal(result.item.photos[0].url,'https://example.test/photo.jpg');
    await page.getByRole('button',{name:'새로운 합성 수업 자세히 보기'}).click();
    await page.getByRole('button',{name:'수정',exact:true}).click();
    await page.getByRole('dialog').locator('details.optional-fields > summary').click();
    await page.getByRole('dialog').getByLabel('수업 성찰').fill('수정한 성찰');
    await page.getByRole('button',{name:'수업 저장',exact:true}).click();
    await page.waitForFunction(()=>fixture.saved.length===2);
    assert.equal(await page.evaluate(()=>fixture.saved[1].item.id),'project-new');
    assert.equal(await page.evaluate(()=>fixture.saved[1].item.reflection),'수정한 성찰');
    await page.getByRole('dialog').getByRole('button',{name:'이력 가상 연수 강의'}).click();
    assert.deepEqual(await page.evaluate(()=>fixture.opened),['career:career-a']);
  });
});

test('project detail opens cross-links, loads photos only by request, and confirms deletion on mobile',browserOptions,async()=>{
  await fixture(async(page,requests)=>{
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{
      const project={...fixture.state.items[0],title:'안전한 <img onerror=alert(1)> 기록',outputs:[{label:'허용되지 않는 링크',url:'javascript:alert(1)'}],photos:[{label:'합성 사진',url:'https://example.test/private-photo.jpg'}]};
      fixture.seed([project],[{from:'career:career-a',to:'project:project-a'}]);
      fixture.setFocus('project-a');
    });
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    assert.equal(await dialog.locator('a[href^="javascript:"]').count(),0);
    assert.equal(await dialog.locator('img').count(),0);
    assert.equal(requests.length,0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.match(await dialog.innerText(),/안전한 <img onerror=alert\(1\)> 기록/);
    await dialog.getByRole('button',{name:'사진 미리보기',exact:true}).click();
    await page.waitForFunction(()=>document.body.innerText.includes('이 주소는 미리보기를 지원하지 않아요.'));
    assert.deepEqual(requests,['https://example.test/private-photo.jpg']);
    assert.equal(await dialog.getByRole('link',{name:'원본 보기'}).getAttribute('href'),'https://example.test/private-photo.jpg');
    await dialog.getByRole('button',{name:'수업 삭제',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixture.deleted.length),0);
    await page.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixture.deleted.length),0);
    await page.getByRole('dialog').getByRole('button',{name:'수업 삭제',exact:true}).click();
    await page.evaluate(()=>fixture.advanceRevision());
    await page.getByRole('dialog',{name:'수업을 삭제할까요?'}).getByRole('button',{name:'수업 삭제',exact:true}).click();
    await page.waitForFunction(()=>fixture.deleted.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.deleted),['project-a']);
    assert.deepEqual(await page.evaluate(()=>fixture.deleteRevisions),[0], 'delete keeps revision from confirmation opening');
    assert.equal(await page.evaluate(()=>fixture.state.items.length),0);
    assert.equal(await page.evaluate(()=>localStorage.length),0);
  });
});
