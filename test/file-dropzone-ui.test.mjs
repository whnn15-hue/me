import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root=new URL('..',import.meta.url).pathname,chromiumPath=process.env.CHROMIUM_PATH||'/usr/bin/chromium';
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
  import {createRoot} from 'react-dom/client';import {useState} from 'react';import MaterialsView from './src/workspace/MaterialsView';
  globalThis.fixture={uploads:[],saves:[]};
  const workspace={schemaVersion:1,revision:0,links:[],items:[]};
  function Fixture(){const [busy,setBusy]=useState(false);globalThis.fixture.setBusy=setBusy;return <MaterialsView workspace={workspace} careers={[]} purpose="classroom" uploading={busy}
    onFiles={async(files,purpose)=>{globalThis.fixture.uploads.push({purpose,names:files.map(file=>file.name)});setBusy(true)}}
    onSave={async(...args)=>{globalThis.fixture.saves.push(args)}} onDelete={async()=>{}} onOpen={()=>{}} onError={()=>{}}/>;}
  createRoot(document.getElementById('root')).render(<Fixture/>);
`},bundle:true,platform:'browser',format:'iife',write:false,outdir:'/tmp/dropzone-ui-fixture',jsx:'automatic'});
test('dragging hands files to classroom automatic registration once, locks while busy and keeps optional fields folded',{skip:!existsSync(chromiumPath)&&!existsSync(chromium.executablePath())},async()=>{
  const javascript=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8')+(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'')+readFileSync(new URL('../src/refinements.css',import.meta.url),'utf8');
  const server=createServer((req,res)=>{if(req.url==='/bundle.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(javascript);res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end(`<style>${css}body{padding:16px}</style><div id="root"></div><script src="/bundle.js"></script>`)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try {
    browser=await chromium.launch({executablePath:existsSync(chromiumPath)?chromiumPath:undefined,args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const origin=`http://127.0.0.1:${server.address().port}`;await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin);
    const drop=page.locator('.file-dropzone');await drop.waitFor();
    const transfer=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['synthetic content'],'가상 속담.txt',{type:'text/plain'}));return data;});
    await drop.dispatchEvent('dragenter',{dataTransfer:transfer});assert.match(await drop.getAttribute('class'),/dragging/);
    await drop.dispatchEvent('drop',{dataTransfer:transfer});
    await page.waitForFunction(()=>fixture.uploads.length===1);
    assert.deepEqual(await page.evaluate(()=>fixture.uploads),[{purpose:'classroom',names:['가상 속담.txt']}]);
    await drop.dispatchEvent('drop',{dataTransfer:transfer});assert.equal(await page.evaluate(()=>fixture.uploads.length),1);
    await page.evaluate(()=>fixture.setBusy(false));
    await page.getByLabel('자료 파일을 끌어 놓으면 자동 정리',{exact:true}).setInputFiles({name:'가상 읽기.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic')});
    await page.waitForFunction(()=>fixture.uploads.length===2);
    await page.getByRole('button',{name:'자료 추가',exact:true}).click();const editor=page.getByRole('dialog');
    assert.equal(await editor.locator('details.optional-fields').getAttribute('open'),null);
    assert.equal(await editor.getByText('내가 만든 자료',{exact:true}).count(),0);assert.equal(await editor.getByText('모아둔 자료',{exact:true}).count(),0);
    await editor.getByPlaceholder('다시 찾기 쉬운 자료 제목').fill('가상 속담');
    await editor.locator('details.classification-options > summary').click();
    await editor.getByRole('checkbox',{name:'국어',exact:true}).check();
    await editor.getByRole('checkbox',{name:'어휘',exact:true}).check();
    await editor.getByRole('button',{name:'자료 저장',exact:true}).click();await page.waitForFunction(()=>fixture.saves.length===1);
    const saved=await page.evaluate(()=>fixture.saves[0][0]);assert.equal(saved.purpose,'classroom');assert.deepEqual(saved.subjects,['국어']);assert.ok(saved.trainings.includes('어휘'));
    await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
