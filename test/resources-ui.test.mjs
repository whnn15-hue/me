import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';

const wav=Buffer.alloc(8044,128);wav.write('RIFF');wav.writeUInt32LE(8036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(8000,40);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import {useState} from 'react';import {createRoot} from 'react-dom/client';import MaterialsView from './src/workspace/MaterialsView';import ResourceStorage from './src/workspace/ResourceStorage';
import {materialDraft} from './shared/material-classification.mjs';import {normalizeWorkspaceItem,mutateWorkspace} from './shared/workspace.mjs';
window.fixture={audioCalls:0,quotaCalls:0,quotaError:true,saves:[],drops:[],urls:[],revoked:[]};
const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);fixture.urls.push(url);return url;};URL.revokeObjectURL=url=>{fixture.revoked.push(url);revoke(url);};
const files=['박수 효과음.wav','차분한 BGM.mp3','수업 발표 템플릿.potx','국어 연수.pdf'];
const initial={schemaVersion:1,revision:0,links:[],items:[...files.map((name,index)=>{const item=normalizeWorkspaceItem({...materialDraft(name),id:'resource_'+index,fileUrl:'https://drive.google.com/file/d/fixture_'+index+'/view',sourceFile:{name,size:8044,sha256:'a'.repeat(64)}});if(index===2){delete item.resourceType;delete item.sourceFile;}return item;}),normalizeWorkspaceItem({...materialDraft('교원 연수 영상.txt'),id:'learning_video',title:'교원 연수 영상',resourceType:'lecture',format:'영상'}),normalizeWorkspaceItem({...materialDraft('국어 듣기 연습.wav','classroom'),id:'classroom_audio',purpose:'classroom'})]};
const quota=async()=>{fixture.quotaCalls++;if(fixture.quotaError)throw Error('provider error');return {used:1024**3,limit:15*1024**3,remaining:14*1024**3};};
function Fixture(){const [workspace,setWorkspace]=useState(initial);const params=new URLSearchParams(location.search);if(params.has('storage'))return <ResourceStorage workspace={workspace} items={workspace.items} readStorage={quota}/>;return <MaterialsView workspace={workspace} careers={[]} onError={e=>{throw e;}} onOpen={()=>{}} library={params.get('library')==='video'?'video':'learning'} purpose={params.has('classroom')?'classroom':'lecture'}
onSave={async(item,links,expectedRevision)=>{fixture.saves.push(item);setWorkspace(current=>mutateWorkspace(current,{operation:item.id?'update':'create',id:item.id,item:{...item,id:item.id||'new_resource'},links,expectedRevision},[]));}}
onDelete={async(id,expectedRevision)=>setWorkspace(current=>mutateWorkspace(current,{operation:'delete',id,expectedRevision},[]))}
onFiles={async files=>{fixture.drops.push(...files.map(file=>file.name));}}
readDriveStorage={quota}
loadAudioPreview={async()=>{fixture.audioCalls++;return new Blob([Uint8Array.from(atob('${wav.toString('base64')}'),c=>c.charCodeAt(0))],{type:'audio/wav'});}}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,write:false,format:'iife',jsx:'automatic',outdir:'/tmp/resources-ui'});

test('learning and video libraries stay separate through filtering, editing, adding and audio preview',{skip:!existsSync('/usr/bin/chromium')},async()=>{
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
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.goto(origin+'?library=video');await page.getByRole('heading',{name:'영상 작업',exact:true}).waitFor();
    assert.equal(await page.locator('.material-card').count(),3);assert.equal(await page.evaluate(()=>fixture.audioCalls+fixture.quotaCalls),0);
    assert.equal(await page.locator('.resource-storage').count(),0);
    const filters=page.getByLabel('자료 종류 필터',{exact:true});
    await filters.selectOption('sound');assert.equal(await page.locator('.material-card').count(),1);
    await page.getByRole('button',{name:'박수 효과음 상세보기'}).click();assert.equal(await page.evaluate(()=>fixture.audioCalls),0);
    await page.getByRole('button',{name:'오디오 들어보기'}).click();await page.locator('audio').waitFor();
    assert.equal(await page.evaluate(()=>fixture.audioCalls),1);assert.equal(await page.locator('audio').getAttribute('autoplay'),null);
    await page.waitForFunction(()=>document.querySelector('audio').readyState>=1);
    await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).last().click();assert.equal(await page.evaluate(()=>fixture.revoked.length),1);
    await filters.selectOption('template');assert.equal(await page.locator('.material-card').count(),1);
    await page.getByRole('button',{name:'수업 발표 템플릿 수정',exact:true}).click();const editor=page.getByRole('dialog',{name:'자료 수정'});
    await editor.getByLabel('제목',{exact:false}).fill('영상 인트로 구성');await editor.getByRole('button',{name:'자료 저장'}).click();
    assert.equal((await page.evaluate(()=>fixture.saves.at(-1))).resourceType,'template');await page.getByRole('button',{name:'영상 인트로 구성 상세보기'}).waitFor();
    await page.locator('input[type=file]').setInputFiles({name:'연습.wav',mimeType:'audio/wav',buffer:wav});assert.deepEqual(await page.evaluate(()=>fixture.drops),['연습.wav']);
    await filters.selectOption('');await page.getByLabel('영상 작업 검색',{exact:true}).fill('배경음악');assert.equal(await page.locator('.material-card').count(),1);
    await page.getByRole('button',{name:/필터 초기화/}).click();assert.equal(await page.locator('.material-card').count(),3);
    await page.getByRole('button',{name:'자료 추가',exact:true}).click();const newEditor=page.getByRole('dialog',{name:'자료 추가',exact:true});
    assert.equal(await newEditor.getByLabel('자료 종류',{exact:true}).inputValue(),'template');
    await newEditor.getByLabel('제목',{exact:false}).fill('새로운 영상 오프닝');await newEditor.getByRole('button',{name:'자료 저장',exact:true}).click();
    await page.getByRole('button',{name:'새로운 영상 오프닝 상세보기'}).waitFor();assert.equal(await page.locator('.material-card').count(),4);
    assert.equal((await page.evaluate(()=>fixture.saves.at(-1))).resourceType,'template');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.doesNotMatch(await page.locator('body').innerText(),/·/);assert.deepEqual(errors,[]);
    mkdirSync('/tmp/resource-preview',{recursive:true});await page.screenshot({path:'/tmp/resource-preview/library-light.png',fullPage:true});
    await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await page.screenshot({path:'/tmp/resource-preview/library-dark.png',fullPage:true});
    await page.goto(origin);await page.getByRole('heading',{name:'학습 자료',exact:true}).waitFor();
    assert.equal(await page.locator('.material-card').count(),2);assert.equal(await page.getByRole('button',{name:'교원 연수 영상 상세보기'}).count(),1);
    assert.equal(await page.getByLabel('자료 종류 필터',{exact:true}).count(),0);assert.doesNotMatch(await page.locator('.materials-toolbar').innerText(),/배경음악|효과음|템플릿/);
    await page.getByRole('button',{name:'자료 추가',exact:true}).click();const learningEditor=page.getByRole('dialog',{name:'자료 추가',exact:true});
    assert.equal(await learningEditor.getByLabel('자료 종류',{exact:true}).count(),0);await learningEditor.getByLabel('제목',{exact:false}).fill('새로운 학습 자료');await learningEditor.getByRole('button',{name:'자료 저장',exact:true}).click();
    await page.getByRole('button',{name:'새로운 학습 자료 상세보기'}).waitFor();assert.equal((await page.evaluate(()=>fixture.saves.at(-1))).resourceType,'lecture');
    await page.goto(origin+'?classroom=1');await page.getByRole('heading',{name:'학급 자료',exact:true}).waitFor();
    assert.equal(await page.locator('.material-card').count(),1);assert.equal(await page.getByLabel('자료 종류 필터',{exact:true}).count(),0);
    await page.goto(origin+'?storage=1');await page.locator('.resource-storage summary').click();
    await page.getByRole('button',{name:'드라이브 용량 확인',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('progressbar').count(),0);
    await page.evaluate(()=>{fixture.quotaError=false;});await page.getByRole('button',{name:'드라이브 용량 확인',exact:true}).click();await page.getByRole('progressbar').waitFor();
    assert.match(await page.locator('.drive-quota').innerText(),/14 GB 남음/);assert.equal(await page.evaluate(()=>fixture.quotaCalls),2);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
