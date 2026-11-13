import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
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
    import {StrictMode,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import EvidenceImport from './src/EvidenceImport';
    import {evidenceCodeFromHash,useEvidenceLink} from './src/evidence-link';
    globalThis.fixture={reads:0,reviewReads:0,calls:[],errors:[],toasts:[],refreshes:0,release:null,progress:null,liveCareers:null,newCareers:[]};
    globalThis.fixture.parseEvidenceLink=evidenceCodeFromHash;
    function Fixture(){
      const [busy,setBusy]=useState(false), [drive,setDrive]=useState(true);
      const [signedIn,setSignedIn]=useState(!location.hash.includes('evidence='));
      const [initialCode,clearCode]=useEvidenceLink();
      globalThis.fixture.setDrive=setDrive;
      if(!signedIn)return <button onClick={()=>setSignedIn(true)}>가상 계정 로그인</button>;
      return <EvidenceImport driveConnected={drive} disabled={busy} onBusyChange={setBusy}
        initialCode={initialCode??undefined} onInitialCodeConsumed={clearCode}
        onRefresh={async()=>{globalThis.fixture.refreshes++;}}
        onToast={message=>{globalThis.fixture.toasts.push(message);}}
        onBackup={async()=>{globalThis.fixture.backup=true;}}/>;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);
  ` },
  bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
  plugins: [{ name: 'isolated-evidence-import-fixture', setup(builder) {
    builder.onResolve({filter:/^\.\/backup-code$/}, ({importer}) => importer.endsWith('/EvidenceImport.tsx') ? {path:'code',namespace:'fixture'} : undefined);
    builder.onResolve({filter:/^\.\/free\/evidence-import$/}, ({importer}) => importer.endsWith('/EvidenceImport.tsx') ? {path:'importer',namespace:'fixture'} : undefined);
    builder.onResolve({filter:/^\.\/evidence-approvals$/}, () => ({path:'approved-fingerprints',namespace:'approvals-fixture'}));
    builder.onLoad({filter:/.*/,namespace:'approvals-fixture'}, () => ({loader:'js',contents:`export const approvedEvidenceLinkArchives=['${createHash('sha256').update('links-approved fixture bytes').digest('hex')}'];export const approvedEvidenceDetailArchives=['${createHash('sha256').update('details-approved fixture bytes').digest('hex')}'];export const approvedEvidenceArchives=['${createHash('sha256').update('approved fixture bytes').digest('hex')}'];export const approvedEvidenceNewCareerArchives=['${createHash('sha256').update('new-approved fixture bytes').digest('hex')}','${createHash('sha256').update('links-approved fixture bytes').digest('hex')}'];`}));
    builder.onLoad({filter:/.*/,namespace:'fixture'}, ({path})=>({loader:'js',resolveDir:root,contents:path==='code'?`
      export async function evidenceFileFromImportCode(code){
        if(code==='IMEV1:9999000011112222.'+'A'.repeat(43))return new File(['links-approved fixture bytes'],'fixture.zip',{type:'application/zip'});
        if(code==='IMEV1:5555666677778888.'+'A'.repeat(43))return new File(['details-approved fixture bytes'],'fixture.zip',{type:'application/zip'});
        if(code==='IMEV1:1111222233334444.'+'A'.repeat(43))return new File(['new-approved fixture bytes'],'fixture.zip',{type:'application/zip'});
        const approved=code==='IMEV1:fedcba9876543210.'+'A'.repeat(43);
        if(!approved && code!=='IMEV1:SYNTHETIC_FIXTURE' && code!=='IMEV1:0123456789abcdef.'+'A'.repeat(43)) throw new Error('증빙 코드를 다시 확인해 주세요.');
        return new File([approved?'approved fixture bytes':'fixture bytes'],'fixture.zip',{type:'application/zip'});
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
        const added=globalThis.fixture.newCareers;
        const approved=['approved fixture bytes','new-approved fixture bytes','details-approved fixture bytes','links-approved fixture bytes'].includes(await file.text());
        return {format:'career-evidence-import',version:1,careers:[...careers,...added],careerDetails:globalThis.fixture.careerDetails,linkCorrections:globalThis.fixture.linkCorrections,
          documents:documents.map(document=>({...document,recordIds:[...(approved&&!document.recordIds.length?['fixture_career_b']:document.recordIds),...added.filter(career=>career.documentIds.includes(document.id)).map(career=>career.id)]})),
          ...(added.length?{newCareerIds:added.map(career=>career.id)}:{})};
      }
      export async function readEvidenceImportReviewCareers(){
        globalThis.fixture.reviewReads++;
        return globalThis.fixture.liveCareers ?? careers;
      }
      export async function applyEvidenceImport(prepared,options){
        globalThis.fixture.calls.push({links:JSON.parse(JSON.stringify(options.approvedLinks)),documents:prepared.documents.length,newCareerIds:options.approvedNewCareerIds,automatic:options.requireMatchingCareerDetails,allowNew:options.allowAutomaticNewCareers,allowDetails:options.allowAutomaticCareerDetails,allowLinkCorrections:options.allowAutomaticLinkCorrections});
        if(globalThis.fixture.failCall)throw new Error('가상 업로드 실패');
        globalThis.fixture.progress=options.onProgress;
        options.onProgress({phase:'uploading',completed:0,total:2,fileName:documents[0].name});
        await new Promise((resolve,reject)=>{
          globalThis.fixture.release=resolve;
          options.signal.addEventListener('abort',()=>{globalThis.fixture.release=null;reject(new DOMException('Aborted','AbortError'));},{once:true});
        });
        options.onProgress({phase:'done',completed:2,total:2});
        return {added:1,duplicates:1,linked:1,careersUpdated:1,unmatched:1,careersAdded:options.approvedNewCareerIds?.length||0,detailsUpdated:options.allowAutomaticCareerDetails?1:0,linksCorrected:options.allowAutomaticLinkCorrections?1:0};
      }
    `}));
  }}],
});

async function fixture(run, hash = '') {
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
    await page.goto(origin+'/fixture'+hash);
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
    assert.match(await page.locator('body').innerText(),/드라이브를 연결하면/);
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

test('new career preview requires confirmation, deselection removes its links, and accepted records are counted',browserOptions,async()=>{
  await fixture(async page=>{
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{
      fixture.newCareers=[
        {id:'new_career_one',title:'가상 신규 강의',category:'강의·연수',tags:['영상'],startDate:'2026-03-05',endDate:'',organization:'테스트 기관',role:'강사',description:'활동일과 역할은 공문에서 확인했습니다.',documentIds:['fixture_document_a']},
        {id:'new_career_two',title:'가상 신규 협의회',category:'위원회·지원단',tags:[],startDate:'2026-04',endDate:'',organization:'테스트 기관',role:'참석 대상',description:'참석 안내이며 실제 참석 여부를 확인해 주세요.',documentIds:['fixture_document_b']},
      ];
    });
    await page.getByLabel('증빙 가져오기 코드',{exact:true}).fill('IMEV1:SYNTHETIC_FIXTURE');
    await page.getByRole('button',{name:'증빙 목록 확인',exact:true}).click();
    const newSection=page.getByRole('region',{name:'새 경력 2건 추가'});
    await newSection.waitFor();
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
    assert.equal(await newSection.getByRole('checkbox',{name:/가상 신규 강의/}).isChecked(),true);
    const declined=newSection.getByRole('checkbox',{name:/가상 신규 협의회/});
    await declined.uncheck();
    const documentChoice=page.locator('.evidence-review-list').getByRole('checkbox',{name:/가상 신규 협의회/});
    assert.equal(await documentChoice.isChecked(),false);
    assert.equal(await documentChoice.isDisabled(),true);
    assert.equal(await page.getByRole('region',{name:'새 경력 1건 추가'}).count(),1);
    await page.locator('.evidence-new-careers').getByText('정리한 내용과 확인 사항',{exact:true}).first().click();
    assert.match(await page.locator('.evidence-new-careers').innerText(),/활동일과 역할은 공문에서 확인/);
    assert.doesNotMatch(await page.locator('.evidence-new-careers').innerText(),/·/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('button',{name:'증빙 추가하고 연결',exact:true}).click();
    await page.waitForFunction(()=>fixture.calls.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].newCareerIds),['new_career_one']);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].links),{fixture_document_a:['fixture_career_a','fixture_career_b','new_career_one'],fixture_document_b:[]});
    await page.evaluate(()=>fixture.release());
    await page.getByText('새 경력 1건을 추가했습니다.',{exact:true}).waitFor();
    assert.match(await page.evaluate(()=>fixture.toasts[0]),/새 경력 1건/);
  });
});

test('previously imported suggestions show current career labels and are never offered as new twice',browserOptions,async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>{
      fixture.newCareers=[{id:'new_career_one',title:'예전 이름',category:'강의·연수',tags:[],startDate:'2026-03',organization:'예전 기관',documentIds:['fixture_document_a']}];
      fixture.liveCareers=[{id:'new_career_one',title:'내가 수정한 활동',category:'강의·연수',tags:[],startDate:'2026-03-05',organization:'현재 기관'}];
    });
    await page.getByLabel('증빙 가져오기 코드',{exact:true}).fill('IMEV1:SYNTHETIC_FIXTURE');
    await page.getByRole('button',{name:'증빙 목록 확인',exact:true}).click();
    const confirm=page.getByRole('button',{name:'증빙 추가하고 연결',exact:true});
    await confirm.waitFor();
    assert.equal(await page.locator('.evidence-new-careers').count(),0);
    assert.equal(await page.getByRole('checkbox',{name:/내가 수정한 활동/}).isChecked(),true);
    await confirm.click();
    await page.waitForFunction(()=>fixture.calls.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].newCareerIds),[]);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].links),{fixture_document_a:['new_career_one'],fixture_document_b:[]});
    await page.evaluate(()=>fixture.release());
    await page.getByText('증빙이 내 경력에 자리 잡았어요',{exact:true}).waitFor();
  });
});

test('private links survive sign-in, load preselected matches once and never save on opening',browserOptions,async()=>{
  const code='IMEV1:0123456789abcdef.'+'A'.repeat(43);
  await fixture(async page=>{
    await page.getByRole('button',{name:'가상 계정 로그인',exact:true}).waitFor();
    assert.equal(new URL(page.url()).hash,'#settings');
    assert.equal(await page.evaluate(()=>globalThis.fixture.reads),0);
    assert.equal(await page.evaluate(()=>globalThis.fixture.calls.length),0);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    await page.getByRole('button',{name:'가상 계정 로그인',exact:true}).click();
    await page.getByRole('heading',{name:'연결된 이력을 확인해 주세요',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.fixture.reads),1);
    assert.equal(await page.evaluate(()=>globalThis.fixture.reviewReads),1);
    assert.equal(await page.evaluate(()=>globalThis.fixture.calls.length),0);
    assert.equal(await page.locator('.evidence-review-list input[type=checkbox]:checked').count(),2);
    assert.equal(await page.getByLabel('증빙 가져오기 코드',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    await page.getByRole('button',{name:'증빙 추가하고 연결',exact:true}).click();
    await page.waitForFunction(()=>globalThis.fixture.calls.length===1);
    const sent=await page.evaluate(()=>globalThis.fixture.calls[0]);
    assert.deepEqual(sent.links.fixture_document_a,['fixture_career_a','fixture_career_b']);
    assert.deepEqual(sent.links.fixture_document_b,[]);
    await page.evaluate(()=>globalThis.fixture.release());
    await page.getByRole('heading',{name:'증빙이 내 경력에 자리 잡았어요',exact:true}).waitFor();
    // Following the same link again reloads the review, never saves again.
    await page.evaluate(code=>{location.hash='#settings?evidence='+encodeURIComponent(code);},code);
    await page.getByRole('heading',{name:'연결된 이력을 확인해 주세요',exact:true}).waitFor();
    assert.equal(new URL(page.url()).hash,'#settings');
    assert.equal(await page.evaluate(()=>globalThis.fixture.reads),2);
    assert.equal(await page.evaluate(()=>globalThis.fixture.calls.length),1);
  },'#settings?evidence='+encodeURIComponent(code));
});

test('link parsing rejects other destinations, ambiguous parameters and oversized or malformed codes',browserOptions,async()=>{
  await fixture(async page=>{
    const result=await page.evaluate(()=>{
      const parse=globalThis.fixture.parseEvidenceLink;
      const code='IMEV1:0123456789abcdef.'+'A'.repeat(43);
      const invalid=[
        '#home?evidence='+code,
        '?evidence='+code,
        '#settings?evidence='+code+'&evidence='+code,
        '#settings?evidence='+code+'&save=true',
        '#settings?evidence=IMEV1:missing',
        '#settings?evidence='+code+'x',
        '#settings?evidence='+code+' '.repeat(600),
      ];
      return {valid:parse('#settings?evidence='+encodeURIComponent(code))===code,invalid:invalid.map(parse)};
    });
    assert.equal(result.valid,true);assert.ok(result.invalid.every(value=>value===null));
    assert.equal(await page.evaluate(()=>globalThis.fixture.reads),0);
    assert.equal(await page.evaluate(()=>globalThis.fixture.calls.length),0);
  });
});

const approvedLink='#settings?evidence='+encodeURIComponent('IMEV1:fedcba9876543210.'+'A'.repeat(43));
test('owner-approved exact archives automatically save once after sign-in without a confirmation click',browserOptions,async()=>{
  await fixture(async page=>{
    await page.getByRole('button',{name:'가상 계정 로그인'}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),0);
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    await page.waitForFunction(()=>fixture.calls.length===1&&fixture.release);
    assert.equal(await page.evaluate(()=>fixture.calls[0].automatic),true);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].links),{
      fixture_document_a:['fixture_career_a','fixture_career_b'],fixture_document_b:['fixture_career_b'],
    });
    await page.evaluate(()=>fixture.release());
    await page.getByRole('heading',{name:'증빙이 내 경력에 자리 잡았어요'}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    assert.equal(await page.evaluate(()=>fixture.reads),1);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    assert.equal(new URL(page.url()).hash,'#settings');
  },approvedLink);
});

test('automatic saving waits for the storage connection and respects cancellation or manual link changes',browserOptions,async()=>{
  for(const choice of ['connect','cancel','edit']) await fixture(async page=>{
    await page.evaluate(()=>fixture.setDrive(false));
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    const cancel=page.getByRole('button',{name:'자동 저장 취소'});
    await cancel.waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),0);
    if(choice==='cancel')await cancel.click();
    if(choice==='edit')await page.getByRole('checkbox',{name:/가상 학교 강의/}).uncheck();
    await page.evaluate(()=>fixture.setDrive(true));
    if(choice==='connect'){
      await page.waitForFunction(()=>fixture.calls.length===1&&fixture.release);
      await page.evaluate(()=>fixture.release());
      await page.getByRole('heading',{name:'증빙이 내 경력에 자리 잡았어요'}).waitFor();
    }else{
      await page.waitForFunction(()=>!document.querySelector('button.button.primary:disabled'));
      assert.equal(await page.evaluate(()=>fixture.calls.length),0);
      assert.equal(await cancel.count(),0);
    }
  },approvedLink);
});

test('approved packages fall back to review when target identity changed or new careers are proposed',browserOptions,async()=>{
  for(const changed of ['identity','new'])await fixture(async page=>{
    await page.evaluate(changed=>{
      if(changed==='identity')fixture.liveCareers=[{id:'fixture_career_a',title:'별개의 활동',startDate:'2024'}];
      else fixture.newCareers=[{id:'new_career',title:'신규 활동',category:'기타',tags:[],startDate:'2025',organization:'테스트 기관',description:'',documentIds:['fixture_document_b']}];
    },changed);
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    await page.getByText('연결 대상 이력이 변경되어 자동 저장을 멈췄습니다. 아래 연결만 확인해 주세요.').waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),0);
    assert.equal(await page.getByRole('button',{name:'자동 저장 취소'}).count(),0);
  },approvedLink);
});

test('an automatic upload failure does not retry itself and manual retry remains available',browserOptions,async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>{fixture.failCall=true;});
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(),/가상 업로드 실패/);
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    await page.evaluate(()=>{fixture.failCall=false;fixture.setDrive(false);});
    await page.evaluate(()=>fixture.setDrive(true));
    await page.getByRole('button',{name:'증빙 추가하고 연결',exact:true}).click();
    await page.waitForFunction(()=>fixture.calls.length===2&&fixture.release);
    assert.equal(await page.evaluate(()=>fixture.calls[1].automatic),false);
    await page.evaluate(()=>fixture.release());
    await page.getByRole('heading',{name:'증빙이 내 경력에 자리 잡았어요'}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),2);
  },approvedLink);
});

test('a modified archive cannot grant itself automatic approval',browserOptions,async()=>{
  await fixture(async page=>{
    await page.getByLabel('가져올 증빙 묶음 ZIP',{exact:true}).setInputFiles({
      name:'approved.zip',mimeType:'application/zip',buffer:Buffer.from('approved fixture bytes tampered {"autoSave":true}'),
    });
    await page.getByRole('button',{name:'증빙 추가하고 연결',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),0);
    assert.equal(await page.getByRole('button',{name:'자동 저장 취소'}).count(),0);
  });
});

test('separately approved new-career batches create their reviewed suggestions without another click',browserOptions,async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>{fixture.newCareers=[{id:'new_career',title:'추가할 연수',category:'강의·연수',tags:[],startDate:'2026-06-01',organization:'가상 기관',description:'강사 위촉',documentIds:['fixture_document_b']}];});
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    await page.waitForFunction(()=>fixture.calls.length===1&&fixture.release);
    assert.equal(await page.evaluate(()=>fixture.calls[0].allowNew),true);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[0].newCareerIds),['new_career']);
    await page.evaluate(()=>fixture.release());
    await page.getByText('새 경력 1건을 추가했습니다.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
  },'#settings?evidence='+encodeURIComponent('IMEV1:1111222233334444.'+'A'.repeat(43)));
});

test('separately approved institution and date batches save automatically and show the detail count',browserOptions,async()=>{
  await fixture(async page=>{
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    await page.waitForFunction(()=>fixture.calls.length===1&&fixture.release);
    assert.equal(await page.evaluate(()=>fixture.calls[0].allowDetails),true);
    assert.equal(await page.evaluate(()=>fixture.calls[0].allowNew),false);
    await page.evaluate(()=>fixture.release());
    await page.getByText('증빙을 바탕으로 이력 1건을 보완했습니다.').waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    assert.equal(new URL(page.url()).hash,'#settings');
  },'#settings?evidence='+encodeURIComponent('IMEV1:5555666677778888.'+'A'.repeat(43)));
});

test('approved corrected titles remain eligible for automatic replay, but unrelated renames stop it',browserOptions,async()=>{
  for(const changed of [false,true])await fixture(async page=>{
    await page.evaluate(changed=>{
      fixture.careerDetails=[{careerId:'fixture_career_a',sourceDocumentIds:['fixture_document_a'],title:{before:'가상 학교 강의',after:'가상 학교 영상 강의'}}];
      fixture.liveCareers=[
        {id:'fixture_career_a',title:changed?'사용자가 다른 활동으로 바꾼 제목':'가상 학교 영상 강의',startDate:'2025-03',organization:'테스트 기관'},
        {id:'fixture_career_b',title:'가상 위원회',startDate:'2025-04',organization:'테스트 기관'},
      ];
    },changed);
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    if(changed){
      await page.getByText('연결 대상 이력이 변경되어 자동 저장을 멈췄습니다. 아래 연결만 확인해 주세요.').waitFor();
      assert.equal(await page.evaluate(()=>fixture.calls.length),0);
    }else{
      await page.waitForFunction(()=>fixture.calls.length===1&&fixture.release);
      assert.equal(await page.evaluate(()=>fixture.calls[0].allowDetails),true);
      await page.evaluate(()=>fixture.release());
      await page.getByText('증빙을 바탕으로 이력 1건을 보완했습니다.').waitFor();
      assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    }
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  },'#settings?evidence='+encodeURIComponent('IMEV1:5555666677778888.'+'A'.repeat(43)));
});


test('only a separately fingerprint-approved link repair passes removal permission to automatic saving', {skip:!existsSync(chromiumPath)}, async()=>{
  for(const [asset,allowed] of [['9999000011112222',true],['fedcba9876543210',false]]) {
    await fixture(async page=>{
      await page.getByRole('button',{name:'가상 계정 로그인'}).click();
      await page.waitForFunction(()=>fixture.calls.length===1&&fixture.release);
      assert.equal(await page.evaluate(()=>fixture.calls[0].allowLinkCorrections),allowed);
      assert.equal(await page.evaluate(()=>fixture.calls[0].automatic),true);
      await page.evaluate(()=>fixture.release());
      await page.waitForFunction(()=>fixture.refreshes===1);
      assert.equal(await page.evaluate(()=>fixture.toasts.some(message=>message.includes('기존 연결 1개 정정'))),allowed);
    },'#settings?evidence='+encodeURIComponent('IMEV1:'+asset+'.'+'A'.repeat(43)));
  }
});

const linkRepairCode='IMEV1:9999000011112222.'+'A'.repeat(43);
const linkRepairUrl='#settings?evidence='+encodeURIComponent(linkRepairCode);

test('a failed approved link repair has an explicit guarded retry after reconnecting, without an automatic loop',browserOptions,async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>{
      fixture.failCall=true;
      fixture.linkCorrections=[{documentId:'fixture_document_a',previousCareer:{id:'old_career',title:'예전 연결',startDate:'2025'}}];
    });
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    await page.getByRole('alert').waitFor();
    const retry=page.getByRole('button',{name:'검토된 연결 다시 시도',exact:true});
    await retry.waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    assert.equal(await page.evaluate(()=>fixture.reviewReads),1);
    const original=await page.evaluate(()=>fixture.calls[0].links);
    await page.evaluate(()=>{fixture.failCall=false;fixture.setDrive(false);});
    assert.equal(await retry.isDisabled(),true);
    await page.evaluate(()=>fixture.setDrive(true));
    await page.waitForFunction(()=>!document.querySelector('button.button.primary:disabled'));
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    await retry.click();
    await page.waitForFunction(()=>fixture.calls.length===2&&fixture.release);
    assert.equal(await page.evaluate(()=>fixture.reviewReads),2);
    assert.equal(await page.evaluate(()=>fixture.calls[1].automatic),true);
    assert.equal(await page.evaluate(()=>fixture.calls[1].allowLinkCorrections),true);
    assert.deepEqual(await page.evaluate(()=>fixture.calls[1].links),original);
    await page.evaluate(()=>fixture.release());
    await page.getByRole('heading',{name:'증빙이 내 경력에 자리 잡았어요'}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.calls.length),2);
    assert.equal(await page.evaluate(()=>fixture.toasts.length),1);
  },linkRepairUrl);
});

test('changing a link or new-career choice permanently invalidates reviewed retry for that loaded package',browserOptions,async()=>{
  for(const choice of ['link','new-career'])await fixture(async page=>{
    await page.evaluate(choice=>{
      fixture.failCall=true;
      fixture.linkCorrections=[{documentId:'fixture_document_a',previousCareer:{id:'old_career',title:'예전 연결',startDate:'2025'}}];
      if(choice==='new-career')fixture.newCareers=[{id:'new_career',title:'새로운 연수',category:'강의, 연수',tags:[],startDate:'2026-06-01',organization:'가상 기관',description:'강사 위촉',documentIds:['fixture_document_b']}];
    },choice);
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    const retry=page.getByRole('button',{name:'검토된 연결 다시 시도',exact:true});
    await retry.waitFor();
    const selected=choice==='link'
      ? page.getByRole('checkbox',{name:/가상 학교 강의/})
      : page.locator('.evidence-new-careers').getByRole('checkbox',{name:/새로운 연수/});
    await selected.uncheck();
    assert.equal(await retry.count(),0);
    await selected.check();
    assert.equal(await retry.count(),0);
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    await page.evaluate(()=>{fixture.failCall=false;});
    await page.getByRole('button',{name:'증빙 추가하고 연결',exact:true}).click();
    await page.waitForFunction(()=>fixture.calls.length===2&&fixture.release);
    assert.equal(await page.evaluate(()=>fixture.calls[1].automatic),false);
    assert.equal(await page.evaluate(()=>fixture.calls[1].allowLinkCorrections),false);
    await page.evaluate(()=>fixture.release());
    await page.getByRole('heading',{name:'증빙이 내 경력에 자리 잡았어요'}).waitFor();
  },linkRepairUrl);
});

test('a changed target identity blocks reviewed retries before saving and never triggers another automatic attempt',browserOptions,async()=>{
  for(const timing of ['before-prepare','before-retry'])await fixture(async page=>{
    await page.evaluate(timing=>{
      fixture.linkCorrections=[{documentId:'fixture_document_a',previousCareer:{id:'old_career',title:'예전 연결',startDate:'2025'}}];
      if(timing==='before-prepare')fixture.liveCareers=[{id:'fixture_career_a',title:'다른 활동',startDate:'2025'}];
      else fixture.failCall=true;
    },timing);
    await page.getByRole('button',{name:'가상 계정 로그인'}).click();
    const retry=page.getByRole('button',{name:'검토된 연결 다시 시도',exact:true});
    if(timing==='before-retry'){
      await retry.waitFor();
      await page.evaluate(()=>{
        fixture.failCall=false;
        fixture.liveCareers=[{id:'fixture_career_a',title:'다른 활동',startDate:'2025'}];
      });
      await retry.click();
    }
    await page.getByText('연결 대상 이력이 변경되어 자동 저장을 멈췄습니다. 아래 연결만 확인해 주세요.').waitFor();
    assert.equal(await retry.count(),0);
    assert.equal(await page.evaluate(()=>fixture.calls.length),timing==='before-retry'?1:0);
    assert.equal(await page.getByRole('button',{name:'자동 저장 취소'}).count(),0);
    await page.evaluate(()=>fixture.setDrive(false));
    await page.evaluate(()=>fixture.setDrive(true));
    await page.waitForFunction(()=>!document.querySelector('button.button.primary:disabled'));
    assert.equal(await page.evaluate(()=>fixture.calls.length),timing==='before-retry'?1:0);
  },linkRepairUrl);
});
