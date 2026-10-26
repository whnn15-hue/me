import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const output=await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import AiConnection from './src/AiConnection';window.outerSaves=0;window.refreshes=0;createRoot(document.getElementById('root')).render(<form onSubmit={e=>{e.preventDefault();window.outerSaves++;}}><AiConnection compact onRefresh={async()=>{window.refreshes++;}}/></form>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'import.meta.env':'{}'}});
test('AI connection UI masks the key, prevents accidental parent submit, tests before saving and clears secret state', {skip:!existsSync('/usr/bin/chromium')},async()=>{
 let connected=false, fail=false, modelsFailure=false, holdModels=false, releaseModels, modelsStarted, retireFirst=false, connectedModel='gemini-fixture-flash';const requests=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(output.outputFiles[0].text);
  if(req.url==='/api/ai/settings' || req.url==='/api/ai/models'){
   const chunks=[];for await (const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();requests.push({method:req.method,body});
   if(req.url==='/api/ai/models'){
    if(holdModels)await new Promise(resolve=>{releaseModels=resolve;modelsStarted();});
    if(modelsFailure)return res.writeHead(504,{'Content-Type':'application/json'}).end(JSON.stringify({error:'모델 목록을 조회하는 중 응답 대기 시간이 초과되었습니다.',diagnostic:{stage:'models',kind:'timeout',elapsedMs:15000,apiKey:'MUST_NOT_LEAVE_RESPONSE',message:'MUST_NOT_LEAVE_RESPONSE'}}));
    return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({models:['gemini-fixture-flash','gemini-fixture-flash-alternative']}));
   }
   if(req.method==='PUT' && fail)return res.writeHead(429,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Gemini 사용 한도에 도달했습니다.'}));
   if(req.method==='PUT' && retireFirst && JSON.parse(body).model==='gemini-fixture-flash')return res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'모델을 사용할 수 없습니다.',diagnostic:{stage:'probe',kind:'model',httpStatus:404}}));
   if(req.method==='PUT'){connected=true;connectedModel=JSON.parse(body).model;}if(req.method==='DELETE')connected=false;
   return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({aiConfigured:connected,model:connected?connectedModel:'auto',source:connected?'app':'none'}));
  }
  const css=['styles.css','theme.css','ai-overview.css'].map(file=>readFileSync('src/'+file,'utf8')).join('\n');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<style>${css}body{padding:30px}#root{max-width:700px}</style><div id="root"></div><script src="/bundle.js"></script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedDiagnostic=text;}}}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const field=page.getByLabel('Gemini API 키',{exact:true});await field.waitFor();assert.equal(await field.getAttribute('type'),'password');
  await page.getByText('모델 설정, 자동 선택',{exact:true}).click();await page.getByLabel('모델 직접 지정').check();await page.getByLabel('Gemini 모델',{exact:true}).fill('gemini-unavailable-flash');await page.getByLabel('모델 직접 지정').uncheck();
  assert.equal(await field.getAttribute('maxlength'),null);
  await field.fill('synthetic...masked');await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/가려진/);assert.equal(requests.filter(r=>r.method==='PUT').length,0);
  const secret='synthetic.'+'A'.repeat(300)+'/+=_end', pasted=' "'+secret+'" ';await field.fill(pasted);await field.press('Enter');assert.equal(await page.evaluate(()=>outerSaves),0);assert.equal(requests.filter(r=>r.method==='PUT').length,0);
  fail=true;await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('한도'));assert.equal(connected,false);assert.equal(await field.inputValue(),pasted);assert.equal(JSON.parse(requests.find(r=>r.method==='PUT').body).apiKey,secret);
  assert.equal(JSON.parse(requests.find(r=>r.method==='PUT').body).model,'gemini-fixture-flash');assert.equal(JSON.parse(requests.find(r=>r.method==='PUT').body).modelSelection,'auto');assert.equal(requests.filter(r=>r.method==='PUT').length,1);
  modelsFailure=true;holdModels=true;const started=new Promise(resolve=>{modelsStarted=resolve;});await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.getByText('1/2 사용 가능한 모델 확인 중',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'연결 확인 후 저장'}).isDisabled(),true);await started;releaseModels();holdModels=false;
  await page.getByText('GEMINI_MODELS_TIMEOUT',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.method==='PUT').length,1);await page.getByRole('button',{name:'오류 정보 복사'}).click();await page.waitForFunction(()=>!!window.copiedDiagnostic);
  const diagnostic=await page.evaluate(()=>window.copiedDiagnostic);assert.equal(JSON.parse(diagnostic).code,'GEMINI_MODELS_TIMEOUT');assert.ok(!diagnostic.includes('MUST_NOT_LEAVE_RESPONSE'));assert.ok(!diagnostic.includes(secret));assert.equal(await field.inputValue(),pasted);modelsFailure=false;
  fail=false;retireFirst=true;await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.getByText('Gemini 연결됨',{exact:true}).waitFor();assert.equal(await page.getByLabel('새 Gemini API 키').inputValue(),'');assert.equal(await page.evaluate(()=>refreshes),1);await page.getByText('gemini-fixture-flash-alternative',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.method==='PUT').length,3);
  assert.ok(!await page.evaluate(key=>JSON.stringify(localStorage).includes(key) || JSON.stringify(sessionStorage).includes(key),secret));
  assert.equal(await page.getByRole('link',{name:'Google AI Studio에서 키 발급'}).getAttribute('href'),'https://aistudio.google.com/apikey');
  await page.getByRole('button',{name:'연결 해제',exact:true}).click();await page.getByText('연결 필요',{exact:true}).waitFor();assert.equal(connected,false);assert.equal(await page.evaluate(()=>outerSaves),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
