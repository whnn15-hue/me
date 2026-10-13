import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

// All fixture names, records, and credentials are invented. Only the import
// review UI is exercised here; archive validation and atomic writes are tested
// independently in the evidence-import and free runtime suites.
const bundle = await build({
  absWorkingDir: root,
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import EvidenceImport from './src/EvidenceImport';
    globalThis.fixture={reads:0,reviewReads:0,calls:[],errors:[],toasts:[],refreshes:0,release:null,progress:null,liveCareers:null};
    function Fixture(){
      const [busy,setBusy]=useState(false), [drive,setDrive]=useState(true);
      globalThis.fixture.setDrive=setDrive;
      return <EvidenceImport driveConnected={drive} disabled={busy} onBusyChange={setBusy}
        onRefresh={async()=>{globalThis.fixture.refreshes++;}}
        onToast={message=>{globalThis.fixture.toasts.push(message);}}
        onBackup={async()=>{globalThis.fixture.backup=true;}}/>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
  plugins: [{ name: 'isolated-evidence-import-fixture', setup(builder) {
    builder.onResolve({filter:/^\.\/backup-code$/}, ({importer}) => importer.endsWith('/EvidenceImport.tsx') ? {path:'code',namespace:'fixture'} : undefined);
    builder.onResolve({filter:/^\.\/free\/evidence-import$/}, ({importer}) => importer.endsWith('/EvidenceImport.tsx') ? {path:'importer',namespace:'fixture'} : undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'}, ({path})=>({loader:'js',resolveDir:root,contents:path==='code'?`
      export async function evidenceFileFromImportCode(code){
        if(code!=='IMEV1:SYNTHETIC_FIXTURE') throw new Error('증빙 코드를 다시 확인해 주세요.');
        return new File(['fixture bytes'],'fixture.zip',{type:'application/zip'});
      }
    `:`
      const careers=[
        {id:'fixture_career_a',title:'가상 학교 강의',startDate:'2025-03',organization:'테스트 기관'},
        {id:'fixture_career_b',title:'가상 위원회',startDate:'2025-04',organization:'테스트 기관'},
      ];
      const documents=[
        {id:'fixture_document_a',name:'가상 강의 공문.pdf',size:2048,recordIds:['fixture_career_a','fixture_career_b'],analysisStatus:'연결 검토',text:'연결 근거: 일정과 기관이 일치합니다.\\n[원문 텍스트]\\nPRIVATE_BODY_MUST_NOT_BE_SHOWN',bytes:new Uint8Array([1]),sha256:'fixture'},
        {id:'fixture_document_b',name:'가상 기타 공문.xlsx',size:1048576,recordIds:[],analysisStatus:'확인 필요',text:'[원문 텍스트]\\nPRIVATE_BODY_MUST_NOT_BE_SHOWN',bytes:new Uint8Array([2]),sha256:'fixture'},
      ];
      export async function readEvidenceImportFile(file){
        globalThis.fixture.reads++;
        if(!file.size) throw new Error('증빙 파일을 확인해 주세요.');
        return {format:'career-evidence-import',version:1,careers,documents};
      }
      export async function readEvidenceImportReviewCareers(){
        globalThis.fixture.reviewReads++;
        return globalThis.fixture.liveCareers ?? careers;
      }
      export async function applyEvidenceImport(prepared,options){
        globalThis.fixture.calls.push({links:JSON.parse(JSON.stringify(options.approvedLinks)),documents:prepared.documents.length});
        globalThis.fixture.progress=options.onProgress;
        options.onProgress({phase:'uploading',completed:0,total:2,fileName:documents[0].name});
        await new Promise((resolve,reject)=>{
          globalThis.fixture.release=resolve;
          options.signal.addEventListener('abort',()=>{globalThis.fixture.release=null;reject(new DOMException('Aborted','AbortError'));},{once:true});
        });
        options.onProgress({phase:'done',completed:2,total:2});
        return {added:1,duplicates:1,linked:1,careersUpdated:1,unmatched:1};
      }
    `}));
  }}],
});

async function fixture(run) {
  const styles = readFileSync(new URL('../src/EvidenceImport.css', import.meta.url), 'utf8');
  const server = createServer((request,response)=>{
    if(request.url==='/bundle.js') return response.writeHead(200,{'Content-Type':'application/javascript'}).end(bundle.outputFiles[0].text);
    if(request.url==='/fixture') return response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<style>*{box-sizing:border-box}body{margin:16px;font-family:Arial}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.settings-card{padding:22px;max-width:850px}textarea{width:100%}.button{padding:10px;display:inline-flex;gap:6px;align-items:center}.text-button{background:none;border:0;padding:6px;cursor:pointer}${styles}</style><div id="root"></div><script src="/bundle.js"></script>`);
    response.writeHead(404).end();
  });
  let browser;
  const pageErrors=[], externalRequests=[];
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});
    const page=await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    await page.goto(origin+'/fixture');
    await run(page);
    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(externalRequests,[]);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}

const browserOptions = {skip:!existsSync(chromiumPath)&&!existsSync(chromium.executablePath())};

test('evidence review requires explicit confirmation, keeps editable links and can cancel safely',browserOptions,async()=>{
  await fixture(async page=>{
    const code=page.getByLabel('증빙 가져오기 코드',{exact:true});
    const prepare=page.getByRole('button',{name:'증빙 목록 확인',exact:true});
    assert.equal(await prepare.isDisabled(),true);
    await code.fill('PRIVATE_INVALID_SENTINEL'); await prepare.click();
    await page.getByRole('alert').waitFor();
    assert.doesNotMatch(await page.getByRole('alert').innerText(),/PRIVATE_INVALID_SENTINEL/);
    assert.equal(await page.evaluate(()=>fixture.reads),0);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);

    await code.fill('IMEV1:SYNTHETIC_FIXTURE'); await prepare.click();
    const confirm=page.getByRole('button',{name:'증빙 추가하고 연결',exact:true});
    await confirm.waitFor();
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
    assert.equal(await code.count(),0);
    assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_BODY_MUST_NOT_BE_SHOWN/);
    await page.getByText('연결 근거와 확인 사항',{exact:true}).click();
    assert.match(await page.locator('body').innerText(),/일정과 기관이 일치합니다/);
    assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE_BODY_MUST_NOT_BE_SHOWN/);
    await page.getByRole('checkbox',{name:/가상 위원회/}).uncheck();
    assert.equal(await page.getByRole('checkbox',{name:/가상 학교 강의/}).isChecked(),true);
    await page.getByRole('button',{name:'취소',exact:true}).click();
    await code.waitFor();
    assert.equal(await code.inputValue(),'');
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);

    await code.fill('IMEV1:SYNTHETIC_FIXTURE'); await prepare.click();
    await confirm.waitFor();
    await page.getByRole('checkbox',{name:/가상 위원회/}).uncheck();
    await confirm.click();
    await page.waitForFunction(()=>fixture.calls.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].links),{fixture_document_a:['fixture_career_a'],fixture_document_b:[]});
    assert.equal(await page.getByRole('button',{name:'증빙 추가 중',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('checkbox',{name:/가상 학교 강의/}).isDisabled(),true);
    await page.getByRole('button',{name:'중단하기',exact:true}).click();
    await confirm.waitFor();
    assert.match(await page.locator('body').innerText(),/증빙 추가를 중단했습니다/);
    assert.equal(await page.getByRole('checkbox',{name:/가상 위원회/}).isChecked(),false);
    assert.equal(await page.evaluate(()=>fixture.toasts.length),0);
    assert.equal(await page.evaluate(()=>localStorage.length),0);
    assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  });
});

test('evidence review waits for Drive, prevents cancellation while saving, and reports duplicates on completion',browserOptions,async()=>{
  await fixture(async page=>{
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>fixture.setDrive(false));
    await page.getByLabel('가져올 증빙 묶음 ZIP',{exact:true}).setInputFiles({name:'synthetic_evidence.zip',mimeType:'application/zip',buffer:Buffer.from('fixture bytes')});
    const confirm=page.getByRole('button',{name:'증빙 추가하고 연결',exact:true});
    await confirm.waitFor();
    assert.equal(await confirm.isDisabled(),true);
    assert.match(await page.locator('body').innerText(),/구글 드라이브를 연결하면/);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.evaluate(()=>fixture.setDrive(true));
    await confirm.click();
    await page.waitForFunction(()=>fixture.calls.length===1);
    await page.evaluate(()=>fixture.progress({phase:'saving',completed:2,total:2}));
    assert.equal(await page.getByRole('button',{name:'중단하기',exact:true}).isDisabled(),true);
    await page.evaluate(()=>fixture.release());
    await page.getByText('증빙이 내 경력에 자리 잡았어요',{exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/원본 1개 추가, 동일 파일 1개 재사용, 경력 연결 1개 저장/);
    assert.equal(await page.evaluate(()=>fixture.refreshes),1);
    assert.equal(await page.evaluate(()=>fixture.toasts.length),1);
    assert.equal(await page.getByRole('checkbox').count(),0);
    assert.equal(await page.getByLabel('증빙 가져오기 코드',{exact:true}).count(),0);
    await page.getByRole('button',{name:'지금 백업하기',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixture.backup),true);
    await page.getByRole('button',{name:/다른 증빙 가져오기/}).click();
    const code=page.getByLabel('증빙 가져오기 코드',{exact:true});
    await code.waitFor();
    assert.equal(await code.inputValue(),'');
    assert.equal(await page.evaluate(()=>localStorage.length),0);
  });
});

test('evidence review displays fresh renamed careers and excludes deleted targets before approval',browserOptions,async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>{
      fixture.liveCareers=[{id:'fixture_career_a',title:'수정한 현재 강의',startDate:'2026-07',organization:'현재 기관'}];
    });
    await page.getByLabel('증빙 가져오기 코드',{exact:true}).fill('IMEV1:SYNTHETIC_FIXTURE');
    await page.getByRole('button',{name:'증빙 목록 확인',exact:true}).click();
    const confirm=page.getByRole('button',{name:'증빙 추가하고 연결',exact:true});
    await confirm.waitFor();
    assert.equal(await page.evaluate(()=>fixture.reviewReads),1);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
    const current=page.getByRole('checkbox',{name:/수정한 현재 강의/});
    assert.equal(await current.isChecked(),true);
    assert.equal(await current.isDisabled(),false);
    const removed=page.getByRole('checkbox',{name:/가상 위원회/});
    assert.equal(await removed.isChecked(),false);
    assert.equal(await removed.isDisabled(),true);
    assert.match(await page.locator('body').innerText(),/현재 기록에 변경된 항목: 제목, 기관, 기간/);
    assert.match(await page.locator('body').innerText(),/묶음 당시: 가상 학교 강의/);
    assert.match(await page.locator('body').innerText(),/현재 경력 목록에서 찾을 수 없어 연결 대상에서 제외했습니다/);
    assert.match(await page.locator('body').innerText(),/2026-07, 현재 기관/);
    await confirm.click();
    await page.waitForFunction(()=>fixture.calls.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].links),{fixture_document_a:['fixture_career_a'],fixture_document_b:[]});
    await page.evaluate(()=>fixture.release());
    await page.getByText('증빙이 내 경력에 자리 잡았어요',{exact:true}).waitFor();
  });
});
