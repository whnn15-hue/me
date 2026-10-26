import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
const output=await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import AiConnection from './src/AiConnection';window.outerSaves=0;window.refreshes=0;createRoot(document.getElementById('root')).render(<form onSubmit={e=>{e.preventDefault();window.outerSaves++;}}><AiConnection compact onRefresh={async()=>{window.refreshes++;}}/></form>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'import.meta.env':'{}'}});
test('AI connection UI masks the key, prevents accidental parent submit, tests before saving and clears secret state', {skip:!existsSync('/usr/bin/chromium')},async()=>{
 let connected=false, fail=false;const requests=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js')return res.writeHead(200,{'Content-Type':'application/javascript'}).end(output.outputFiles[0].text);
  if(req.url==='/api/ai/settings'){
   const chunks=[];for await (const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();requests.push({method:req.method,body});
   if(req.method==='PUT' && fail)return res.writeHead(429,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Gemini 사용 한도에 도달했습니다.'}));
   if(req.method==='PUT')connected=true;if(req.method==='DELETE')connected=false;
   return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({aiConfigured:connected,model:'gemini-2.5-flash',source:connected?'app':'none'}));
  }
  const css=['styles.css','theme.css','ai-overview.css'].map(file=>readFileSync('src/'+file,'utf8')).join('\n');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<style>${css}body{padding:30px}#root{max-width:700px}</style><div id="root"></div><script src="/bundle.js"></script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const field=page.getByLabel('Gemini API 키',{exact:true});await field.waitFor();assert.equal(await field.getAttribute('type'),'password');
  const secret='synthetic-browser-key-not-real-12345';await field.fill(secret);await field.press('Enter');assert.equal(await page.evaluate(()=>outerSaves),0);assert.equal(requests.filter(r=>r.method==='PUT').length,0);
  fail=true;await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.getByRole('alert').waitFor();assert.equal(connected,false);assert.equal(await field.inputValue(),secret);
  fail=false;await page.getByRole('button',{name:'연결 확인 후 저장'}).click();await page.getByText('Gemini 연결됨',{exact:true}).waitFor();assert.equal(await page.getByLabel('새 Gemini API 키').inputValue(),'');assert.equal(await page.evaluate(()=>refreshes),1);
  assert.ok(!await page.evaluate(key=>JSON.stringify(localStorage).includes(key) || JSON.stringify(sessionStorage).includes(key),secret));
  assert.equal(await page.getByRole('link',{name:'Google AI Studio에서 키 발급'}).getAttribute('href'),'https://aistudio.google.com/apikey');
  await page.getByRole('button',{name:'연결 해제',exact:true}).click();await page.getByText('연결 필요',{exact:true}).waitFor();assert.equal(connected,false);assert.equal(await page.evaluate(()=>outerSaves),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
