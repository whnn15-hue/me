import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const output=await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import AiConnection from './src/AiConnection';window.outerSaves=0;window.refreshes=0;createRoot(document.getElementById('root')).render(<form onSubmit={e=>{e.preventDefault();window.outerSaves++;}}><AiConnection compact onRefresh={async()=>{window.refreshes++;}}/></form>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'import.meta.env':'{}'}});
test('AI setup launches once, resumes background verification after reload and never copies secrets into diagnostics', {skip:!existsSync('/usr/bin/chromium')},async()=>{
 let connected=false, fail=false, modelsFailure=false, holdModels=false, releaseModels, modelsStarted, finishWorker;
 let job=null, jobCount=0, connectedModel='gemini-fixture-flash';const requests=[];
 const send=(res,value,status=200)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));
 const connection=()=>({aiConfigured:connected,model:connected?connectedModel:'auto',source:connected?'app':'none'});
 const runs=()=>requests.filter(r=>r.path==='/api/ai/connect/run');
 const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(output.outputFiles[0].text);
  if(req.url.startsWith('/api/ai/')){
   const path=new URL(req.url,'http://fixture').pathname,chunks=[];for await(const chunk of req)chunks.push(chunk);
   const raw=Buffer.concat(chunks).toString(),body=raw?JSON.parse(raw):{};requests.push({path,method:req.method,body});
   if(path==='/api/ai/models'){
    if(holdModels)await new Promise(resolve=>{releaseModels=resolve;modelsStarted();});
    if(modelsFailure)return send(res,{error:'모델 목록을 조회하는 중 응답 대기 시간이 초과되었습니다.',diagnostic:{stage:'models',kind:'timeout',elapsedMs:15000,apiKey:'MUST_NOT_LEAVE_RESPONSE',message:'MUST_NOT_LEAVE_RESPONSE'}},504);
    return send(res,{models:['gemini-fixture-flash','gemini-fixture-flash-alternative']});
   }
   if(path==='/api/ai/connect/start'){
    job={id:'00000000-0000-4000-8000-'+String(++jobCount).padStart(12,'0'),status:'queued'};
    assert.ok(!('apiKey' in body));assert.equal(body.modelSelection,'auto');return send(res,job);
   }
   if(path==='/api/ai/connect/run'){
    assert.equal(body.jobId,job.id);job.status='running';
    if(fail)job={...job,status:'failed',error:'Gemini 사용 한도에 도달했습니다.',diagnostic:{stage:'probe',kind:'quota',httpStatus:429}};
    else finishWorker=()=>{connected=true;connectedModel='gemini-fixture-flash-alternative';job={...job,status:'succeeded',connection:connection()};};
    return res.writeHead(202).end();
   }
   if(path==='/api/ai/connect/status')return send(res,job);
   if(path==='/api/ai/settings'){
    if(req.method==='DELETE'){connected=false;job=null;}
    return send(res,{...connection(),...(job?{job}:{})});
   }
   return send(res,{error:'Unexpected request'},404);
  }
  const css=['styles.css','theme.css','ai-overview.css'].map(file=>readFileSync('src/'+file,'utf8')).join('\n');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<style>${css}body{padding:30px}#root{max-width:700px}</style><div id="root"></div><script src="/bundle.js"></script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedDiagnostic=text;}}}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const field=page.getByLabel('Gemini API 키',{exact:true});await field.waitFor();assert.equal(await field.getAttribute('type'),'password');assert.equal(await field.getAttribute('maxlength'),null);
  await page.getByText('모델 설정, 자동 선택',{exact:true}).click();await page.getByLabel('모델 직접 지정').check();await page.getByLabel('Gemini 모델',{exact:true}).fill('gemini-unavailable-flash');await page.getByLabel('모델 직접 지정').uncheck();
  await field.fill('synthetic...masked');await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/가려진/);assert.equal(runs().length,0);
  const secret='synthetic.'+'A'.repeat(300)+'/+=_end',pasted=' "'+secret+'" ';await field.fill(pasted);await field.press('Enter');assert.equal(await page.evaluate(()=>outerSaves),0);assert.equal(runs().length,0);
  fail=true;await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('한도'));assert.equal(connected,false);assert.equal(await field.inputValue(),pasted);assert.equal(runs()[0].body.apiKey,secret);assert.equal(runs().length,1);assert.ok(!JSON.stringify(job).includes(secret));
  modelsFailure=true;holdModels=true;const started=new Promise(resolve=>{modelsStarted=resolve;});await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.getByText('1/2 사용 가능한 모델 확인 중',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'연결 확인 후 저장'}).isDisabled(),true);await started;releaseModels();holdModels=false;
  await page.getByText('GEMINI_MODELS_TIMEOUT',{exact:true}).waitFor();assert.equal(runs().length,1);await page.getByRole('button',{name:'오류 정보 복사'}).click();await page.waitForFunction(()=>!!window.copiedDiagnostic);
  const diagnostic=await page.evaluate(()=>window.copiedDiagnostic);assert.equal(JSON.parse(diagnostic).code,'GEMINI_MODELS_TIMEOUT');assert.ok(!diagnostic.includes('MUST_NOT_LEAVE_RESPONSE'));assert.ok(!diagnostic.includes(secret));modelsFailure=false;
  fail=false;await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.getByText('Google 응답 확인 중, 최대 90초 정도 걸릴 수 있습니다.',{exact:true}).waitFor();assert.equal(connected,false);assert.equal(runs().length,2);
  await page.reload();await page.getByText('Google 응답 확인 중, 최대 90초 정도 걸릴 수 있습니다.',{exact:true}).waitFor();assert.equal(await field.inputValue(),'');assert.equal(runs().length,2);finishWorker();
  await page.getByText('Gemini 연결됨',{exact:true}).waitFor();assert.equal(await page.getByLabel('새 Gemini API 키').inputValue(),'');assert.equal(await page.evaluate(()=>refreshes),1);await page.getByText('gemini-fixture-flash-alternative',{exact:true}).waitFor();assert.equal(runs().length,2);
  assert.ok(!await page.evaluate(key=>JSON.stringify(localStorage).includes(key) || JSON.stringify(sessionStorage).includes(key),secret));
  assert.equal(await page.getByRole('link',{name:'Google AI Studio에서 키 발급'}).getAttribute('href'),'https://aistudio.google.com/apikey');
  await page.getByRole('button',{name:'연결 해제',exact:true}).click();await page.getByText('연결 필요',{exact:true}).waitFor();assert.equal(connected,false);assert.equal(await page.evaluate(()=>outerSaves),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
