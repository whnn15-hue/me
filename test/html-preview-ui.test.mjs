import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';

const root=new URL('..',import.meta.url).pathname;
const payload=`<!doctype html><html><head><title>분수 연습</title><meta http-equiv="refresh" content="0;url=https://preview-attacker.invalid/redirect"><link rel="stylesheet" href="https://preview-attacker.invalid/style"><style>h1{color:rgb(30,80,60)}body{background-image:url(https://preview-attacker.invalid/css)} @import url(https://preview-attacker.invalid/import);</style></head><body><h1>분수 비교 활동</h1><p>분수의 크기를 비교해 보세요.</p><script>parent.HTML_EXECUTED=true;fetch('https://preview-attacker.invalid/script');parent.localStorage.setItem('preview-secret','stolen')</script><img src="https://preview-attacker.invalid/image" onerror="parent.HTML_EXECUTED=true"><iframe src="https://preview-attacker.invalid/frame"></iframe><a href="https://preview-attacker.invalid/link" target="_top">외부 링크</a><form action="https://preview-attacker.invalid/form"><input autofocus onfocus="parent.HTML_EXECUTED=true"></form><svg><script>alert(1)</script></svg><div onclick="alert(1)">본문</div></body></html>`;
const output=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import {createRoot} from 'react-dom/client';
import MaterialsView from './src/workspace/MaterialsView';
const item={id:'html_demo',kind:'material',title:'분수 비교 활동',purpose:'classroom',format:'HTML',ownership:'created',author:'가상 교사',eventName:'수학 수업',date:'2026-10-16',audience:['학생'],fileUrl:'https://drive.google.com/file/d/htmlpreview123/view',summary:'분수의 크기를 비교하는 활동',tags:['분수','수학'],subjects:['수학'],trainings:['수 연산'],createdAt:'2026-10-16T00:00:00.000Z',updatedAt:'2026-10-16T00:00:00.000Z',sourceFile:{name:'fractions.html',size:1000,sha256:'a'.repeat(64)}};
globalThis.previewLoads=0;
createRoot(document.getElementById('root')).render(<MaterialsView workspace={{schemaVersion:1,revision:0,items:[item,{...item,id:'slides_demo',title:'생각을 나누는 발표 수업',format:'PPT',subjects:['국어'],trainings:['말하기'],summary:'자료를 구성하고 발표하는 방법',favorite:true},{...item,id:'pdf_demo',title:'독서 활동 기록장',format:'PDF',subjects:['국어'],trainings:['읽기'],summary:'읽은 내용을 정리하고 이야기 나누기',fileUrl:''}],links:[]}} careers={[]} purpose="classroom" onSave={async()=>{}} onDelete={async()=>{}} onError={()=>{}} onOpen={()=>{}} onFiles={async()=>{}} loadHtmlPreview={async()=>{globalThis.previewLoads++;return ${JSON.stringify(payload)};}}/>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,loader:{'.css':'empty'}});
const styles=['styles.css','workspace/Workspace.css','workspace/MaterialsView.css','refinements.css','portfolio-library.css'].map(file=>readFileSync(root+'src/'+file,'utf8')).join('\n');
const csp=/Content-Security-Policy = "([^"]+)"/.exec(readFileSync(root+'netlify.toml','utf8'))[1];

test('HTML preview is click-to-load, styled and isolated under the deployed CSP on desktop and phone',async()=>{
  const server=createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',csp);
    if(req.url==='/bundle.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(output.outputFiles[0].text);
    if(req.url==='/')return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<style>${styles}body{padding:32px}#root{max-width:1150px;margin:auto}@media(max-width:650px){body{padding:16px}}</style><div id="root"></div><script src="/bundle.js"></script>`);
    res.writeHead(404).end();
  });
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({executablePath:existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),external=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{const url=route.request().url();if(url.includes('preview-attacker')){external.push(url);return route.abort();}return new URL(url).origin===origin?route.continue():route.abort();});
    await page.goto(origin);
    await expect(page.locator('.material-card')).toHaveCount(3);
    assert.equal(await page.evaluate(()=>previewLoads),0);
    await page.screenshot({path:'/tmp/introduce-me-library-desktop.png',fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'분수 비교 활동 상세보기',exact:true}).click();
    assert.equal(await page.evaluate(()=>previewLoads),0);
    await page.getByRole('button',{name:'HTML 미리보기',exact:true}).click();
    const iframe=page.locator('.html-preview iframe');await expect(iframe).toBeVisible();
    assert.equal(await iframe.getAttribute('sandbox'),'');
    const frame=page.frameLocator('.html-preview iframe');
    await expect(frame.getByRole('heading',{name:'분수 비교 활동'})).toBeVisible();
    await expect(frame.locator('h1')).toHaveCSS('color','rgb(30, 80, 60)');
    assert.equal(await frame.locator('script,iframe,meta[http-equiv=refresh],form,svg').count(),0);
    assert.equal(await frame.locator('a').getAttribute('href'),null);
    assert.equal(await page.evaluate(()=>globalThis.HTML_EXECUTED),undefined);
    assert.equal(await page.evaluate(()=>localStorage.getItem('preview-secret')),null);
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    await page.getByRole('button',{name:'미리보기 닫기',exact:true}).click();
    await expect(iframe).toHaveCount(0);
    await page.getByRole('button',{name:'닫기',exact:true}).last().click();
    await page.setViewportSize({width:375,height:812});
    await page.screenshot({path:'/tmp/introduce-me-library-mobile.png',fullPage:true,animations:'disabled'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'목록 보기',exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('combobox',{name:'자료 형식 필터',exact:true}).selectOption('HTML');
    await expect(page.locator('.material-card')).toHaveCount(1);
    await page.getByRole('button',{name:'분수 비교 활동 상세보기',exact:true}).click();
    await page.getByRole('button',{name:'HTML 미리보기',exact:true}).click();
    await expect(frame.getByRole('heading',{name:'분수 비교 활동'})).toBeVisible();
    assert.equal(await page.evaluate(()=>previewLoads),2);assert.deepEqual(external,[]);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
