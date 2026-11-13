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
    import {StrictMode,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import BackupSettings from './src/BackupSettings';
    import {useOneDriveOAuthRecovery} from './src/onedrive-oauth-recovery';
    const initial={mode:'firebase',deploymentMode:'free',firebaseConfigured:true,
      googleConfigured:true,ownerConfigured:true,driveConfigured:true,driveConnected:true,
      storageProvider:'onedrive',storageAccount:'synthetic@outlook.example',aiConfigured:false,
      user:{name:'가상 사용자',email:'synthetic@example.com'},lastBackup:'2026-11-12T03:04:05.000Z'};
    globalThis.fixture={calls:[],errors:[],hold:false,release:null};
    function Fixture(){
      const [status,setStatus]=useState(initial);
      fixture.patchStatus=patch=>setStatus(current=>({...current,...patch}));
      const error=useOneDriveOAuthRecovery();
      return <BackupSettings status={status} oneDriveOAuthError={error} careers={4} documents={3}
        onRefresh={async()=>{}} onError={error=>fixture.errors.push(error.message)} onToast={()=>{}}/>;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);
  ` },
  bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
  define: { __APP_VERSION__: '"isolated-oauth-recovery"' },
  plugins: [{ name: 'isolated-oauth-recovery', setup(builder) {
    builder.onResolve({ filter:/^\.\/(api|cloud|backup-code|CareerEditor|EvidenceImport|AiConnection|OneDriveMigration|ThemeControl)$/ }, ({path,importer}) =>
      importer.endsWith('/BackupSettings.tsx') ? {path:path.slice(2),namespace:'fixture'} : undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'}, ({path}) => ({loader:'tsx',contents:
      path==='api' ? `
        export async function api(path,options={}){
          fixture.calls.push({path,method:options.method,body:options.body?JSON.parse(options.body):null});
          if(!['/auth/drive/start','/migration/onedrive/start'].includes(path))throw new Error('Unexpected API call');
          if(fixture.hold)await new Promise(resolve=>{fixture.release=resolve;});
          throw new Error('Synthetic connection prepared');
        }
        export async function download(){throw new Error('No downloads allowed');}
      ` : path==='cloud' ? `
        export const cloudMode=true,freeMode=true;
        export async function cloudRefreshToken(){return 'SYNTHETIC_FRESH_FIREBASE_TOKEN';}
        export async function signInCloud(){} export async function signOutCloud(){}
      ` : path==='backup-code' ? `export async function backupFileFromImportCode(){throw new Error('No restore allowed');}`
        : path==='CareerEditor' ? `export function Modal(){return null;}`
          : `export default function Stub(){return null;}`
    }));
  }}],
});

async function fixture(query, run) {
  const server=createServer((req,res)=>{
    if(req.url==='/bundle.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(bundle.outputFiles[0].text);
    if(req.url.startsWith('/fixture'))return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<div id="root"></div><script src="/bundle.js"></script>');
    res.writeHead(404).end();
  });
  let browser; const errors=[],external=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1100}}); page.setDefaultTimeout(6000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(origin+'/fixture'+query);
    await page.getByRole('heading',{name:'OneDrive 백업',exact:true}).waitFor();
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has('onedriveError'));
    await run(page);
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    assert.doesNotMatch(await page.locator('body').innerText(),/SYNTHETIC_FRESH_FIREBASE_TOKEN/);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  }finally{
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }
}

test('StrictMode preserves the safe recovery notice after removing its URL hint, and only a click starts fresh OAuth',browserOptions,async()=>{
  await fixture('?keep=1&onedriveError=state_used#settings',async page=>{
    const notice=page.getByRole('alert',{name:'OneDrive 연결 안내'});
    await notice.waitFor(); assert.match(await notice.innerText(),/이미 처리한 OneDrive 연결 주소/);
    assert.match(page.url(),/\/fixture\?keep=1#settings$/);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[],'a query hint never authorizes an automatic request');
    assert.match(await page.locator('.backup-state').innerText(),/2026/,'last successful backup remains displayed');
    const button=page.getByRole('button',{name:'OneDrive 연결 다시 시작',exact:true});
    await page.evaluate(()=>{fixture.hold=true;}); await button.click();
    await page.waitForFunction(()=>fixture.calls.length===1);
    assert.equal(await button.isDisabled(),true);
    assert.deepEqual(await page.evaluate(()=>fixture.calls),[
      {path:'/auth/drive/start',method:'POST',body:{firebaseRefreshToken:'SYNTHETIC_FRESH_FIREBASE_TOKEN'}},
    ]);
    await page.evaluate(()=>fixture.release());
    await page.waitForFunction(()=>fixture.errors.length===1);
    assert.equal(await button.isEnabled(),true);
  });
});

test('unknown or duplicate callback hints are removed without rendering untrusted content',browserOptions,async()=>{
  for(const query of ['?onedriveError=%3Cscript%3EUNTRUSTED%3C%2Fscript%3E#settings','?onedriveError=state_used&onedriveError=unavailable#settings']){
    await fixture(query,async page=>{
      assert.equal(await page.getByRole('alert',{name:'OneDrive 연결 안내'}).count(),0);
      assert.doesNotMatch(await page.locator('body').innerText(),/UNTRUSTED/);
      assert.deepEqual(await page.evaluate(()=>fixture.calls),[]);
    });
  }
});

test('recovery waits for owner login and uses the separate OneDrive migration route while Google Drive is active',browserOptions,async()=>{
  await fixture('?onedriveError=busy#settings',async page=>{
    const button=page.getByRole('button',{name:'OneDrive 연결 다시 시작',exact:true});
    await page.evaluate(()=>fixture.patchStatus({user:null}));
    await page.getByText('본인 구글 계정으로 로그인한 뒤 새 연결을 시작해 주세요.',{exact:true}).waitFor();
    assert.equal(await button.isDisabled(),true);
    await page.evaluate(()=>fixture.patchStatus({user:{name:'가상 사용자',email:'synthetic@example.com'},storageProvider:'google',oneDriveMigrationAvailable:true}));
    await button.click(); await page.waitForFunction(()=>fixture.calls.length===1);
    assert.equal(await page.evaluate(()=>fixture.calls[0].path),'/migration/onedrive/start');
  });
});
