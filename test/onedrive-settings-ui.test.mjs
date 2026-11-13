import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const browserOptions = { skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()) };
// All identities and tokens here are invented. This exercises the settings
// component without loading Firebase, Drive clients or any real OAuth page.
const bundle = await build({
  absWorkingDir: root,
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import BackupSettings from './src/BackupSettings';
    const initial={mode:'firebase',deploymentMode:'free',firebaseConfigured:true,
      googleConfigured:true,ownerConfigured:true,driveConfigured:true,driveConnected:true,
      storageProvider:'onedrive',storageAccount:'invented@outlook.example',aiConfigured:false,
      user:{name:'가상 사용자',email:'invented@example.com'},lastBackup:'2026-11-12T03:04:05.000Z'};
    globalThis.fixture={calls:[],errors:[],toasts:[],refreshes:0,refreshTokenReads:0,
      holdStart:false,releaseStart:null,backupFails:false,status:initial,nextStatus:initial};
    function Fixture(){
      const [status,setStatus]=useState(initial);
      globalThis.fixture.patchStatus=patch=>setStatus(current=>{
        const next={...current,...patch};globalThis.fixture.status=next;globalThis.fixture.nextStatus=next;return next;
      });
      return <BackupSettings status={status} careers={4} documents={3}
        onRefresh={async()=>{fixture.refreshes++;fixture.status=fixture.nextStatus;setStatus({...fixture.nextStatus});}}
        onError={error=>fixture.errors.push(error.message)} onToast={text=>fixture.toasts.push(text)}/>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` },
  bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
  define: { __APP_VERSION__: '"isolated-settings-fixture"' },
  plugins: [{ name: 'isolated-backup-settings', setup(builder) {
    builder.onResolve({filter:/^\.\/(api|cloud|backup-code|CareerEditor|EvidenceImport|AiConnection|OneDriveMigration|ThemeControl)$/}, ({path,importer}) =>
      importer.endsWith('/BackupSettings.tsx') ? { path:path.slice(2),namespace:'fixture' } : undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'}, ({path}) => ({loader:'tsx',contents:
      path==='api' ? `
        export async function api(path,options={}){
          const f=globalThis.fixture;
          f.calls.push({path,method:options.method,body:options.body?JSON.parse(options.body):null});
          if(path==='/auth/drive/start'){
            if(f.holdStart)await new Promise(resolve=>{f.releaseStart=resolve;});
            // Stop before redirect. The real action and its request are tested
            // without navigating to Microsoft or submitting real credentials.
            throw new Error('가상 로그인 준비 완료');
          }
          if(path==='/backup/drive'){
            if(f.backupFails){
              f.nextStatus={...f.status,driveConnected:false,storageReconnectRequired:true,
                backupError:'OneDrive 권한을 갱신할 수 없습니다. 다시 연결해 주세요.'};
              throw new Error(f.nextStatus.backupError);
            }
            f.nextStatus={...f.status,driveConnected:true,storageReconnectRequired:false,
              backupError:undefined,lastBackup:'2026-11-13T05:06:07.000Z'};
            return {ok:true};
          }
          throw new Error('Unexpected fixture API request');
        }
        export async function download(){throw new Error('No download expected');}
      ` : path==='cloud' ? `
        export const cloudMode=true,freeMode=true;
        export async function cloudRefreshToken(){globalThis.fixture.refreshTokenReads++;return 'SYNTHETIC_FIREBASE_REFRESH_ONLY';}
        export async function signInCloud(){throw new Error('No Google login expected');}
        export async function signOutCloud(){throw new Error('No logout expected');}
      ` : path==='backup-code' ? `export async function backupFileFromImportCode(){throw new Error('No restore expected');}`
        : path==='CareerEditor' ? `export function Modal(){return null;}`
          : `export default function Stub(){return null;}`
    }));
  }}],
});

async function fixture(run) {
  const server=createServer((req,res)=>{
    if(req.url==='/bundle.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(bundle.outputFiles[0].text);
    if(req.url==='/fixture')return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<div id="root"></div><script src="/bundle.js"></script>');
    res.writeHead(404).end();
  });
  let browser;
  const errors=[],external=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(6000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      external.push(route.request().url());return route.abort();
    });
    await page.goto(origin+'/fixture');
    await page.getByRole('heading',{name:'OneDrive 백업',exact:true}).waitFor().catch(error=>{
      if(errors.length)throw new Error(errors.join('\n'));
      throw error;
    });
    await run(page);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    assert.doesNotMatch(await page.locator('body').innerText(),/SYNTHETIC_FIREBASE_REFRESH_ONLY/);
    assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage)+JSON.stringify(sessionStorage))).includes('SYNTHETIC_FIREBASE_REFRESH_ONLY'));
  }finally{
    await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}

test('connected OneDrive reconnects directly without disconnecting, and disables duplicate actions while preparing OAuth',browserOptions,async()=>{
  await fixture(async page=>{
    const reconnect=page.getByRole('button',{name:'OneDrive 다시 연결',exact:true});
    await reconnect.waitFor();await page.evaluate(()=>{fixture.holdStart=true;});await reconnect.click();
    await page.waitForFunction(()=>fixture.calls.length===1);
    assert.equal(await reconnect.isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'지금 백업하기',exact:true}).isDisabled(),true);
    await reconnect.evaluate(button=>button.click());
    assert.equal(await page.evaluate(()=>fixture.calls.length),1);
    const calls=await page.evaluate(()=>fixture.calls);
    assert.deepEqual(calls,[{path:'/auth/drive/start',method:'POST',body:{firebaseRefreshToken:'SYNTHETIC_FIREBASE_REFRESH_ONLY'}}]);
    assert.equal(await page.evaluate(()=>fixture.refreshTokenReads),1);
    await page.evaluate(()=>fixture.releaseStart());
    await page.waitForFunction(()=>fixture.errors.length===1);
    assert.equal(await reconnect.isEnabled(),true);
    assert.equal(await page.evaluate(()=>fixture.status.driveConnected),true);
    assert.equal(await page.evaluate(()=>fixture.status.storageAccount),'invented@outlook.example');
    assert.ok(!calls.some(call=>call.path.includes('disconnect')||call.method==='DELETE'));
  });
});

test('failed backup refreshes revoked connection state, keeps the old backup time, and recovery saves a fresh backup',browserOptions,async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>{fixture.backupFails=true;});
    await page.getByRole('button',{name:'지금 백업하기',exact:true}).click();
    await page.getByText('재연결 필요',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>fixture.refreshes),1);
    assert.equal(await page.evaluate(()=>fixture.status.lastBackup),'2026-11-12T03:04:05.000Z');
    assert.equal(await page.getByRole('button',{name:'지금 백업하기',exact:true}).count(),0);
    assert.match(await page.getByRole('alert').innerText(),/최근 백업 오류.*다시 연결/);
    await page.getByRole('button',{name:'OneDrive 다시 연결',exact:true}).click();
    await page.waitForFunction(()=>fixture.calls.some(call=>call.path==='/auth/drive/start'));
    assert.ok(!(await page.evaluate(()=>fixture.calls)).some(call=>call.path.includes('disconnect')));
    await page.evaluate(()=>{fixture.backupFails=false;fixture.patchStatus({driveConnected:true,storageReconnectRequired:false});});
    await page.getByRole('button',{name:'지금 백업하기',exact:true}).click();
    await page.waitForFunction(()=>fixture.status.lastBackup==='2026-11-13T05:06:07.000Z');
    assert.equal(await page.getByRole('alert').count(),0);
    assert.equal(await page.getByText('재연결 필요',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>fixture.refreshes),2);
    assert.deepEqual(await page.evaluate(()=>fixture.toasts),['OneDrive에 날짜별 백업을 저장했습니다.']);
    assert.equal((await page.evaluate(()=>fixture.calls)).filter(call=>call.path==='/backup/drive').length,2);
  });
});

test('the OneDrive recovery button does not change Google Drive connection controls',browserOptions,async()=>{
  await fixture(async page=>{
    await page.evaluate(()=>fixture.patchStatus({storageProvider:'google',storageAccount:undefined}));
    await page.getByRole('heading',{name:'구글 드라이브 백업',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'OneDrive 다시 연결',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'지금 백업하기',exact:true}).isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:'연결 해제',exact:true}).isEnabled(),true);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
  });
});
