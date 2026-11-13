import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const browserOptions = { skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()) };
const bundle = await build({
  absWorkingDir: root,
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {StrictMode,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import WorkspaceTree from './src/WorkspaceTree';
    import {ArchiveMark} from './src/branding';
    const careers=[
      {id:'lecture',title:'가상 교원 연수',category:'강의·연수',role:'강사',documentIds:[],tags:[]},
      {id:'community',title:'영상제작 콘텐츠 교사 모임 몽당분필',category:'집필·콘텐츠',role:'회원',documentIds:[],tags:[]},
      {id:'honor',title:'가상 교육장 표창',category:'연구·수상',role:'',documentIds:[],tags:[]},
    ];
    globalThis.fixture={navigations:[],categories:[],sections:[],careers};
    function Fixture(){
      const [view,setView]=useState('home'),[category,setCategory]=useState('전체');
      fixture.state={view,category};
      fixture.externalCategory=value=>{setView('careers');setCategory(value);};
      return <div className="app-shell"><aside className="sidebar">
        <a href="#" className="brand" aria-label="C아카이브 홈"><span className="brand-icon"><ArchiveMark/></span><span><strong>C아카이브</strong></span></a>
        <WorkspaceTree view={view} category={category} careers={careers} documents={[]} workspace={{schemaVersion:1,revision:0,items:[],links:[]}}
          onView={value=>{fixture.navigations.push(value);setView(value);}}
          onCategory={value=>{fixture.categories.push(value);setCategory(value);setView('careers');}}
          onSection={(...args)=>{fixture.sections.push(args);setView(args[0]);}}/>
      </aside></div>;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);
  `},
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, loader: { '.css': 'empty' },
});
const styles = ['styles.css','workspace/Workspace.css','refinements.css','career-portfolio.css','portfolio-library.css','studio.css','theme.css','home/home.css','workspace-upgrade.css','record-room.css','upgrade.css','branding.css','career-results.css','workspace-simplify.css','workspace-navigation.css']
  .map(file => readFileSync(new URL('../src/'+file,import.meta.url),'utf8')).join('\n');
async function fixture(run, saved) {
  const server=createServer((request,response)=>{
    if(request.url==='/bundle.js')return response.writeHead(200,{'Content-Type':'application/javascript'}).end(bundle.outputFiles[0].text);
    if(new URL(request.url,'http://localhost').pathname==='/icons/c-archive.svg')return response.writeHead(200,{'Content-Type':'image/svg+xml'}).end(readFileSync(new URL('../public/icons/c-archive.svg',import.meta.url)));
    if(request.url==='/fixture')return response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<style>'+styles+'</style><div id="root"></div><script src="/bundle.js"></script>');
    response.writeHead(404).end();
  });
  let browser;const errors=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    if(saved!==undefined)await page.addInitScript(value=>localStorage.setItem('c-archive-navigation-v3',value),saved);
    await page.goto(origin+'/fixture');await page.getByRole('navigation',{name:'주 메뉴'}).waitFor();
    await run(page);assert.deepEqual(errors,[]);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('career disclosure selects existing presentation categories, preserves records, and keeps video last',browserOptions,async()=>{
  await fixture(async page=>{
    const menu=page.getByRole('navigation',{name:'주 메뉴'});
    assert.deepEqual(await menu.locator('.tree-parent > .nav-item').allTextContents(),['홈','이력','수업','연구 자료','교안','영상 작업']);
    assert.equal(await menu.locator('#tree-careers').count(),0);
    await menu.getByRole('button',{name:'이력 하위 메뉴 펼치기',exact:true}).click();
    assert.equal(await menu.getByRole('button',{name:'이력 하위 메뉴 접기',exact:true}).getAttribute('aria-expanded'),'true');
    assert.deepEqual(await page.evaluate(()=>fixture.navigations),[]);
    assert.deepEqual(await page.evaluate(()=>fixture.categories),[]);
    assert.equal(await menu.getByRole('button',{name:'이력 분류 전체, 3건',exact:true}).count(),1);
    assert.equal(await menu.getByRole('button',{name:'이력 분류 활동 경력, 1건',exact:true}).count(),1);
    assert.equal(await menu.getByRole('button',{name:'이력 분류 콘텐츠 제작, 0건',exact:true}).count(),1);
    assert.equal(await menu.getByRole('button',{name:'이력 분류 표창, 1건',exact:true}).count(),1);
    await menu.getByRole('button',{name:'이력 분류 강의, 연수, 1건',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>fixture.state),{view:'careers',category:'강의·연수'});
    assert.equal(await menu.getByRole('button',{name:'이력 분류 강의, 연수, 1건',exact:true}).getAttribute('aria-current'),'page');
    await menu.getByRole('button',{name:'이력 하위 메뉴 접기',exact:true}).click();
    assert.equal(await menu.locator('#tree-careers').count(),0,'Manual collapse stays collapsed on active career page');
    await menu.getByRole('button',{name:'경력 아카이브',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>fixture.state),{view:'careers',category:'전체'});
    assert.equal(await menu.getByRole('button',{name:'이력 분류 전체, 3건',exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await page.evaluate(()=>fixture.careers[1].category),'집필·콘텐츠','Navigation classification never rewrites stored categories');
    await menu.getByRole('button',{name:'영상 작업',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixture.state.view),'video');
  });
});

test('career disclosure preference survives reload and cross-links reveal their category',browserOptions,async()=>{
  await fixture(async page=>{
    const menu=page.getByRole('navigation',{name:'주 메뉴'});
    await menu.getByRole('button',{name:'이력 하위 메뉴 펼치기',exact:true}).click();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('c-archive-navigation-v3')).careers),true);
    await page.reload();await menu.locator('#tree-careers').waitFor();
    await menu.getByRole('button',{name:'이력 하위 메뉴 접기',exact:true}).click();
    await page.reload();assert.equal(await menu.locator('#tree-careers').count(),0);
    await page.evaluate(()=>fixture.externalCategory('표창'));
    await menu.getByRole('button',{name:'이력 분류 표창, 1건',exact:true}).waitFor();
    assert.equal(await menu.getByRole('button',{name:'이력 분류 표창, 1건',exact:true}).getAttribute('aria-current'),'page');
    const brand=page.locator('.sidebar a.brand'),wordmark=brand.locator('strong'),icon=brand.locator('.archive-mark');
    const b=await brand.boundingBox(),w=await wordmark.boundingBox(),i=await icon.boundingBox();
    assert.ok(i.x>=b.x && w.x+w.width<=b.x+b.width+1,'Logo and name remain inside sidebar brand');
    const offset=(i.x+w.x+w.width)/2-(b.x+b.width/2);
    assert.ok(offset>=2 && offset<=10,'Complete logo group has a small balanced optical inset');
  });
});

test('invalid saved navigation preferences recover without hiding the main destinations',browserOptions,async()=>{
  await fixture(async page=>{
    const menu=page.getByRole('navigation',{name:'주 메뉴'});
    await menu.getByRole('button',{name:'이력 하위 메뉴 펼치기',exact:true}).click();
    assert.equal(await menu.getByRole('button',{name:'이력 분류 전체, 3건',exact:true}).count(),1);
  },'null');
});
