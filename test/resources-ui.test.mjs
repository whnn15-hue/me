import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';

const wav=Buffer.alloc(8044,128);wav.write('RIFF');wav.writeUInt32LE(8036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(8000,40);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import {useState} from 'react';import {createRoot} from 'react-dom/client';import MaterialsView from './src/workspace/MaterialsView';
import {materialDraft} from './shared/material-classification.mjs';import {normalizeWorkspaceItem,mutateWorkspace} from './shared/workspace.mjs';
window.fixture={audioCalls:0,quotaCalls:0,quotaError:true,saves:[],drops:[],urls:[],revoked:[]};
const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);fixture.urls.push(url);return url;};URL.revokeObjectURL=url=>{fixture.revoked.push(url);revoke(url);};
const files=['박수 효과음.wav','차분한 BGM.mp3','수업 발표 템플릿.potx','국어 연수.pdf'];
const initial={schemaVersion:1,revision:0,links:[],items:files.map((name,index)=>normalizeWorkspaceItem({...materialDraft(name),id:'resource_'+index,fileUrl:'https://drive.google.com/file/d/fixture_'+index+'/view',sourceFile:{name,size:8044,sha256:'a'.repeat(64)}}))};
function Fixture(){const [workspace,setWorkspace]=useState(initial);return <MaterialsView workspace={workspace} careers={[]} onError={e=>{throw e;}} onOpen={()=>{}}
onSave={async(item,links,expectedRevision)=>{fixture.saves.push(item);setWorkspace(current=>mutateWorkspace(current,{operation:item.id?'update':'create',id:item.id,item:{...item,id:item.id||'new_resource'},links,expectedRevision},[]));}}
onDelete={async(id,expectedRevision)=>setWorkspace(current=>mutateWorkspace(current,{operation:'delete',id,expectedRevision},[]))}
onFiles={async files=>{fixture.drops.push(...files.map(file=>file.name));}}
readDriveStorage={async()=>{fixture.quotaCalls++;if(fixture.quotaError)throw Error('provider error');return {used:1024**3,limit:15*1024**3,remaining:14*1024**3};}}
loadAudioPreview={async()=>{fixture.audioCalls++;return new Blob([Uint8Array.from(atob('${wav.toString('base64')}'),c=>c.charCodeAt(0))],{type:'audio/wav'});}}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,write:false,format:'iife',jsx:'automatic',outdir:'/tmp/resources-ui'});

test('resource library groups files, plays audio on demand, shows honest quota errors and preserves normal editing',{skip:!existsSync('/usr/bin/chromium')},async()=>{
  const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const css=['styles.css','theme.css','refinements.css','portfolio-library.css','workspace-upgrade.css','record-room.css'].filter(file=>existsSync('src/'+file)).map(file=>readFileSync('src/'+file,'utf8')).join('\n')+(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'');
  if(process.env.RESOURCE_PREVIEW_ARTIFACT) {
    const safeJs=js.replace(/<\/script/gi,'<\\/script');
    writeFileSync(process.env.RESOURCE_PREVIEW_ARTIFACT,`<!doctype html><html lang="ko"><meta charset="utf-8"><title>자료실 미리보기</title><style>${css}body{padding:32px}#root.app-shell{display:block;max-width:1180px;margin:auto}.demo-note{max-width:1180px;margin:0 auto 24px;padding:12px 16px;background:#e8f3f0;color:#215343;border-radius:8px;font:14px sans-serif}</style><p class="demo-note">분류와 재생을 확인하는 샘플입니다. 실제 계정과 연결되지 않으며 용량 수치도 예시입니다. 파일 업로드와 원본 저장은 실제 앱에서 이용하세요. 새로고침하면 초기화됩니다.</p><div id="root" class="app-shell"></div><script>${safeJs};fixture.quotaError=false;</script></html>`);
  }
  const server=createServer((req,res)=>req.url==='/bundle.js'?res.writeHead(200,{'Content-Type':'application/javascript'}).end(js):res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<style>${css}body{padding:32px}#root.app-shell{display:block;max-width:1180px;margin:auto}</style><div id="root" class="app-shell"></div><script src="/bundle.js"></script>`));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:'자료실',exact:true}).waitFor();
    assert.equal(await page.locator('.material-card').count(),4);assert.equal(await page.evaluate(()=>fixture.audioCalls+fixture.quotaCalls),0);
    const filters=page.getByRole('navigation',{name:'자료 분류 필터'});
    await filters.getByRole('button',{name:/효과음과 오디오/}).click();assert.equal(await page.locator('.material-card').count(),1);
    await page.getByRole('button',{name:'박수 효과음 상세보기'}).click();assert.equal(await page.evaluate(()=>fixture.audioCalls),0);
    await page.getByRole('button',{name:'오디오 들어보기'}).click();await page.locator('audio').waitFor();
    assert.equal(await page.evaluate(()=>fixture.audioCalls),1);assert.equal(await page.locator('audio').getAttribute('autoplay'),null);
    await page.waitForFunction(()=>document.querySelector('audio').readyState>=1);
    await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).last().click();assert.equal(await page.evaluate(()=>fixture.revoked.length),1);
    await filters.getByRole('button',{name:/전체/}).click();await page.locator('.resource-storage summary').click();
    await page.getByRole('button',{name:'드라이브 용량 확인',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('progressbar').count(),0);
    await page.evaluate(()=>{fixture.quotaError=false;});await page.getByRole('button',{name:'드라이브 용량 확인',exact:true}).click();await page.getByRole('progressbar').waitFor();
    assert.match(await page.locator('.drive-quota').innerText(),/14 GB 남음/);assert.equal(await page.evaluate(()=>fixture.quotaCalls),2);
    await filters.getByRole('button',{name:/템플릿/}).click();assert.equal(await page.locator('.material-card').count(),1);
    await page.getByRole('button',{name:'수업 발표 템플릿 수정',exact:true}).click();const editor=page.getByRole('dialog',{name:'자료 수정'});
    await editor.getByLabel('제목',{exact:false}).fill('다시 쓰는 발표 양식');await editor.getByRole('button',{name:'자료 저장'}).click();
    assert.equal((await page.evaluate(()=>fixture.saves.at(-1))).resourceType,'template');await page.getByRole('button',{name:'다시 쓰는 발표 양식 상세보기'}).waitFor();
    await page.locator('input[type=file]').setInputFiles({name:'연습.wav',mimeType:'audio/wav',buffer:wav});assert.deepEqual(await page.evaluate(()=>fixture.drops),['연습.wav']);
    await filters.getByRole('button',{name:/전체/}).click();await page.getByLabel('자료실 검색',{exact:true}).fill('배경음악');assert.equal(await page.locator('.material-card').count(),1);
    await page.getByRole('button',{name:/필터 초기화/}).click();assert.equal(await page.locator('.material-card').count(),4);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.doesNotMatch(await page.locator('body').innerText(),/·/);assert.deepEqual(errors,[]);
    mkdirSync('/tmp/resource-preview',{recursive:true});await page.screenshot({path:'/tmp/resource-preview/library-light.png',fullPage:true});
    await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await page.screenshot({path:'/tmp/resource-preview/library-dark.png',fullPage:true});
  } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
