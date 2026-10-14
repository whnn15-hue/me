import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

// Synthetic classroom records only. Both decoding and persistence are mocked,
// and all requests outside this isolated local fixture are blocked.
const bundle = await build({
  absWorkingDir: root,
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import MaterialImport from './src/workspace/MaterialImport';
    globalThis.fixture={decodes:0,reads:0,calls:[],toasts:[],refreshes:0,busy:[],release:null,reject:null,progress:null};
    function Fixture(){
      const [busy,setBusy]=useState(false),[drive,setDrive]=useState(true);
      globalThis.fixture.setDrive=setDrive;
      return <MaterialImport driveConnected={drive} disabled={busy}
        onBusyChange={value=>{globalThis.fixture.busy.push(value);setBusy(value);}}
        onRefresh={async()=>{globalThis.fixture.refreshes++;}}
        onToast={message=>globalThis.fixture.toasts.push(message)}/>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', outfile: 'fixture.js',
  plugins: [{name:'isolated-classroom-import-fixture',setup(builder){
    builder.onResolve({filter:/^\.\.\/backup-code$/},({importer})=>importer.endsWith('/MaterialImport.tsx')?{path:'decoder',namespace:'fixture'}:undefined);
    builder.onResolve({filter:/^\.\.\/free\/material-import$/},({importer})=>importer.endsWith('/MaterialImport.tsx')?{path:'engine',namespace:'fixture'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',resolveDir:root,contents:path==='decoder'?`
      export async function materialFileFromImportCode(code){
        globalThis.fixture.decodes++;
        if(code!=='IMMT1:SYNTHETIC_FIXTURE') throw new Error('학급 자료 코드를 다시 확인해 주세요.');
        return new File(['synthetic bytes'],'fixture.zip',{type:'application/zip'});
      }
    `:`
      const materials=[
        {documentId:'fixture_document_a',item:{id:'fixture_material_a',kind:'material',purpose:'classroom',title:'가상 발표 연습',format:'TXT',summary:'연습용 발표 주제 모음입니다.',tags:['발표·말하기']}},
        {documentId:'fixture_document_b',item:{id:'fixture_material_b',kind:'material',purpose:'classroom',title:'가상 어휘 학습지',format:'HWP',summary:'연습용 어휘를 살펴보는 학습지입니다.',tags:['어휘']}},
      ];
      const documents=[
        {id:'fixture_document_a',name:'synthetic_'+ 'long_filename_'.repeat(15)+'.txt',text:'PRIVATE_SYNTHETIC_BODY_MUST_NOT_BE_SHOWN'},
        {id:'fixture_document_b',name:'가상 학습지.hwp',text:'PRIVATE_SYNTHETIC_BODY_MUST_NOT_BE_SHOWN'},
      ];
      export async function readMaterialImportFile(file){
        globalThis.fixture.reads++;
        if(!file.size) throw new Error('학급 자료 묶음을 확인해 주세요.');
        return {format:'classroom-material-import',version:1,materials,documents};
      }
      export async function applyMaterialImport(prepared,options){
        const selected=[...options.approvedMaterialIds];
        globalThis.fixture.calls.push({selected,documents:prepared.documents.length});
        globalThis.fixture.progress=options.onProgress;
        options.onProgress({phase:'uploading',completed:0,total:selected.length});
        await new Promise((resolve,reject)=>{
          globalThis.fixture.release=resolve;globalThis.fixture.reject=reject;
          options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
        });
        options.onProgress({phase:'done',completed:selected.length,total:selected.length});
        return {added:selected.length,duplicates:0};
      }
    `}));
  }}],
});
const javascript=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;

async function fixture(run){
  const styles=['../src/styles.css','../src/workspace/MaterialImport.css'].map(path=>readFileSync(new URL(path,import.meta.url),'utf8')).join('\n');
  const server=createServer((request,response)=>{
    if(request.url==='/bundle.js') return response.writeHead(200,{'Content-Type':'application/javascript'}).end(javascript);
    if(request.url==='/fixture') return response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<style>${styles}#root{max-width:850px;margin:16px}</style><div id="root"></div><script src="/bundle.js"></script>`);
    response.writeHead(404).end();
  });
  let browser;
  const errors=[],externalRequests=[];
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});
    const page=await browser.newPage();page.setDefaultTimeout(5000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      externalRequests.push(route.request().url());return route.abort();
    });
    await page.goto(origin+'/fixture');
    await page.locator('summary').click();
    await run(page);
    assert.deepEqual(errors,[]);
    assert.deepEqual(externalRequests,[]);
    assert.equal(await page.evaluate(()=>localStorage.length),0);
    assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  } finally {
    await browser?.close();server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}

const browserOptions={skip:!existsSync(chromiumPath)&&!existsSync(chromium.executablePath())};
async function preview(page){
  await page.getByLabel('학급 자료 코드',{exact:true}).fill('IMMT1:SYNTHETIC_FIXTURE');
  await page.getByRole('button',{name:'자료 목록 확인',exact:true}).click();
  await page.getByRole('button',{name:'드라이브에 보관하고 추가',exact:true}).waitFor();
}

test('classroom material preview never writes before approval and cancellation leaves no changes',browserOptions,async()=>{
  await fixture(async page=>{
    const prepare=page.getByRole('button',{name:'자료 목록 확인',exact:true});
    assert.equal(await prepare.isDisabled(),true);
    await page.getByLabel('학급 자료 코드',{exact:true}).fill('PRIVATE_INVALID_SENTINEL');
    await prepare.click();await page.getByRole('alert').waitFor();
    assert.doesNotMatch(await page.getByRole('alert').innerText(),/PRIVATE_INVALID_SENTINEL/);
    assert.equal(await page.evaluate(()=>fixture.reads),0);
    await preview(page);
    assert.equal(await page.evaluate(()=>fixture.reads),1);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
    assert.equal(await page.evaluate(()=>fixture.refreshes),0);
    assert.equal(await page.evaluate(()=>fixture.toasts.length),0);
    assert.equal(await page.getByRole('checkbox').count(),2);
    assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_SYNTHETIC_BODY_MUST_NOT_BE_SHOWN|·/);
    await page.getByRole('button',{name:'취소',exact:true}).click();
    await page.getByLabel('학급 자료 코드',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('학급 자료 코드',{exact:true}).inputValue(),'');
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
  });
});

test('classroom approval sends only selected records and rapid duplicate clicks apply once',browserOptions,async()=>{
  await fixture(async page=>{
    await preview(page);
    await page.getByRole('checkbox',{name:/가상 어휘 학습지/}).uncheck();
    await page.getByRole('heading',{name:'추가할 학급 자료 1개',exact:true}).waitFor();
    const confirm=page.getByRole('button',{name:'드라이브에 보관하고 추가',exact:true});
    await confirm.evaluate(button=>{button.click();button.click();});
    await page.waitForFunction(()=>fixture.calls.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[{selected:['fixture_material_a'],documents:2}]);
    assert.equal(await page.getByRole('button',{name:'학급 자료 추가 중',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('checkbox',{name:/가상 발표 연습/}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>fixture.refreshes),0);
    await page.evaluate(()=>fixture.release());
    await page.getByText('학급 자료 1개 추가, 기존 자료 0개 유지',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    assert.equal(await page.evaluate(()=>fixture.refreshes),1);
    assert.deepEqual(await page.evaluate(()=>fixture.toasts),['학급 자료 1개를 추가했습니다. 이미 있는 자료 0개는 유지했습니다.']);
    assert.equal(await page.getByRole('checkbox').count(),0);
    assert.equal(await page.evaluate(()=>fixture.busy.at(-1)),false);
  });
});

test('classroom ZIP can be reviewed without Drive but import requires a connection and selection',browserOptions,async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>fixture.setDrive(false));
    await page.getByLabel('가져올 학급 자료 ZIP',{exact:true}).setInputFiles({name:'synthetic_materials.zip',mimeType:'application/zip',buffer:Buffer.from('synthetic bytes')});
    const confirm=page.getByRole('button',{name:'드라이브에 보관하고 추가',exact:true});
    await confirm.waitFor();
    assert.equal(await page.evaluate(()=>fixture.decodes),0);
    assert.equal(await page.evaluate(()=>fixture.reads),1);
    assert.equal(await confirm.isDisabled(),true);
    assert.match(await page.locator('body').innerText(),/자료 목록은 먼저 확인할 수 있습니다/);
    await confirm.evaluate(button=>button.click());
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
    await page.evaluate(()=>fixture.setDrive(true));
    await page.getByRole('checkbox',{name:/가상 발표 연습/}).uncheck();
    await page.getByRole('checkbox',{name:/가상 어휘 학습지/}).uncheck();
    assert.equal(await confirm.isDisabled(),true);
    await page.getByRole('checkbox',{name:/가상 어휘 학습지/}).check();
    await confirm.click();await page.waitForFunction(()=>fixture.calls.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].selected),['fixture_material_b']);
    await page.evaluate(()=>fixture.release());
    await page.getByText('학급 자료 1개 추가, 기존 자료 0개 유지',{exact:true}).waitFor();
  });
});

test('classroom import failure shows a useful error and preserves the reviewed selection for retry',browserOptions,async()=>{
  await fixture(async page=>{
    await preview(page);
    await page.getByRole('checkbox',{name:/가상 어휘 학습지/}).uncheck();
    const confirm=page.getByRole('button',{name:'드라이브에 보관하고 추가',exact:true});
    await confirm.click();await page.waitForFunction(()=>fixture.calls.length===1);
    await page.evaluate(()=>fixture.reject(new Error('가상 연결 오류, 다시 시도해 주세요.')));
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(),'가상 연결 오류, 다시 시도해 주세요.');
    assert.equal(await page.getByRole('checkbox',{name:/가상 발표 연습/}).isChecked(),true);
    assert.equal(await page.getByRole('checkbox',{name:/가상 어휘 학습지/}).isChecked(),false);
    assert.equal(await confirm.isDisabled(),false);
    assert.equal(await page.evaluate(()=>fixture.toasts.length),0);
    assert.equal(await page.evaluate(()=>fixture.refreshes),1);
    await confirm.click();await page.waitForFunction(()=>fixture.calls.length===2);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[1].selected),['fixture_material_a']);
    await page.evaluate(()=>fixture.release());
    await page.getByText('학급 자료 1개 추가, 기존 자료 0개 유지',{exact:true}).waitFor();
    assert.equal(await page.getByRole('alert').count(),0);
    assert.equal(await page.evaluate(()=>fixture.refreshes),2);
  });
});

test('classroom import controls and long filenames fit narrow mobile screens',browserOptions,async()=>{
  await fixture(async page=>{
    for(const width of [320,390]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    await preview(page);
    for(const width of [320,390]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const rect=await page.getByRole('button',{name:'드라이브에 보관하고 추가',exact:true}).boundingBox();
      assert.ok(rect && rect.x>=0 && rect.x+rect.width<=width);
    }
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
  });
});
