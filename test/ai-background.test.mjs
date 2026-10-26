import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {createPrivateVault} from '../server/free/vault.mjs';
import {createAiSettings} from '../server/free/ai-settings.mjs';
import {createFreeApi} from '../server/free/api.mjs';
import {verifyGeminiConnection} from '../server/free/gemini.mjs';
import {readAiDiagnostic} from '../shared/ai-diagnostic.mjs';
import {config as workerConfig} from '../netlify/functions/career-ai-background.mjs';

class MemoryBlobs {
  rows=new Map(); version=0;
  async get(key){return this.rows.get(key)?.data ?? null;}
  async getWithMetadata(key){return this.rows.get(key) ?? null;}
  async setJSON(key,data,condition={}) {
    const old=this.rows.get(key);
    if(condition.onlyIfNew && old || condition.onlyIfMatch && condition.onlyIfMatch!==old?.etag) return {modified:false};
    this.rows.set(key,{data:structuredClone(data),etag:String(++this.version)});return {modified:true};
  }
  async delete(key){this.rows.delete(key);}
}
const config={appUrl:'https://record.example',ownerEmail:'owner@example.test',projectId:'record-test',firebaseWebApiKey:'fixture-web-key',driveEnabled:false};
const owner={uid:'fixture-owner',email:config.ownerEmail,token:'fixture-owner-token'};
const secret='synthetic-background-key-never-real';
const settingKey='aiSettings/'+owner.uid, jobKey='aiConnectionJob/'+settingKey;
const models=['gemini-2.5-flash'];
const ok=()=>Response.json({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]});
const request=(path,body,headers={},method=body===undefined?'GET':'POST')=>new Request(config.appUrl+path,{
  method,headers:{Origin:config.appUrl,Authorization:'Bearer fixture-owner','Content-Type':'application/json',...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
});
async function fixture(fetcher=async()=>ok()) {
  const blobs=new MemoryBlobs(),vault=await createPrivateVault(blobs),logs=[];
  const ai=createAiSettings({config,vault,fetcher});
  const api=createFreeApi({config,vault,fetcher,logger:(...args)=>logs.push(args),auth:{identify:async req=>{
    if(req.headers.get('authorization')!=='Bearer fixture-owner') throw Object.assign(new Error('로그인 필요'),{status:401});
    return owner;
  }},repositoryFactory:()=>{throw new Error('Archive records must remain untouched');}});
  return {blobs,vault,ai,api,logs};
}

test('a 31-second provider response completes in the worker while polling stays responsive and duplicate changes are excluded',{timeout:45000},async()=>{
  let calls=0,started;const began=new Promise(resolve=>{started=resolve;});
  const {ai,api,vault,blobs}=await fixture(async(_url,options)=>{
    calls++;assert.equal(options.headers['x-goog-api-key'],secret);started();
    await delay(31000,undefined,{signal:options.signal});return ok();
  });
  const response=await api.handle(request('/api/ai/connect/start',{models,modelSelection:'auto',apiKey:'ignored-extra-value'}));
  assert.equal(response.status,200);const job=await response.json();
  assert.equal(job.status,'queued');assert.equal(await vault.getJSON(settingKey),null);
  assert.ok(!JSON.stringify(await vault.getJSON(jobKey)).includes('apiKey'));
  const startedAt=Date.now();const running=api.runAiConnection(request('/api/ai/connect/run',{jobId:job.id,apiKey:secret}));
  await began;
  const statusAt=Date.now();const statusResponse=await api.handle(request('/api/ai/connect/status?jobId='+job.id));
  assert.ok(Date.now()-statusAt<2000);assert.equal((await statusResponse.json()).status,'running');
  assert.equal((await ai.status(owner)).aiConfigured,false);
  await assert.rejects(ai.jobs.run(owner,{jobId:job.id,apiKey:secret}),error=>error.status===409);
  assert.equal((await api.handle(request('/api/ai/settings',undefined,{},'DELETE'))).status,409);
  assert.equal((await api.handle(request('/api/ai/connect/start',{models}))).status,409);
  const result=await running;assert.ok(Date.now()-startedAt>=30000);assert.equal(result.status,'succeeded');
  assert.equal((await ai.resolve(owner)).geminiKey,secret);assert.equal(calls,1);
  assert.equal((await ai.jobs.run(owner,{jobId:job.id,apiKey:secret})).status,'succeeded');assert.equal(calls,1);
  assert.ok(!JSON.stringify(await ai.status(owner)).includes(secret));
  assert.ok(!JSON.stringify([...blobs.rows]).includes(secret));
  assert.ok(!JSON.stringify(await vault.getJSON(jobKey)).includes(secret));
  await ai.disconnect(owner);assert.equal((await ai.status(owner)).aiConfigured,false);
  assert.equal((await ai.jobs.current(owner)).status,'failed');
});

test('worker, start and polling require the owner and enforce request boundaries before any provider use',async()=>{
  let calls=0;const {ai,api,vault}=await fixture(async()=>{calls++;return ok();});
  const job=await ai.jobs.start(owner,{models});const payload={jobId:job.id,apiKey:secret};
  for(const [req,status] of [
    [request('/api/ai/connect/run',payload,{Authorization:''}),401],
    [request('/api/ai/connect/run',payload,{Origin:'https://other.example'}),403],
    [request('/api/ai/connect/run'),405],
    [request('/api/ai/connect/run',{...payload,extra:'x'.repeat(8192)}),413],
    [request('/api/ai/connect/run',[]),400],
  ]) await assert.rejects(api.runAiConnection(req),error=>error.status===status);
  await assert.rejects(ai.jobs.run({...owner,email:'other@example.test'},payload),error=>error.status===403);
  await assert.rejects(ai.jobs.current({...owner,uid:'different-owner'},job.id),error=>error.status===409);
  await assert.rejects(ai.jobs.start(owner,{models:['https://attacker.invalid/model']}),error=>error.status===400);
  await assert.rejects(ai.jobs.start(owner,{models:['gemini-3-pro']}),error=>error.status===400);
  assert.equal((await api.handle(request('/api/ai/connect/start',{models},{Authorization:''}))).status,401);
  assert.equal((await api.handle(request('/api/ai/connect/status?jobId='+job.id,undefined,{Authorization:''}))).status,401);
  assert.equal((await api.handle(request('/api/ai/connect/run',payload))).status,404);
  assert.equal(calls,0);assert.equal(await vault.getJSON(settingKey),null);
});

test('expired, replaced and disconnected jobs never run generation or restore an old key',async()=>{
  let calls=0;const {ai,vault}=await fixture(async()=>{calls++;return ok();});
  const first=await ai.jobs.start(owner,{models});const second=await ai.jobs.start(owner,{models});
  await assert.rejects(ai.jobs.run(owner,{jobId:first.id,apiKey:secret}),error=>error.status===409);
  const stored=await vault.getJSON(jobKey);await vault.setJSON(jobKey,{...stored,expiresAt:Date.now()-1});
  assert.equal((await ai.jobs.run(owner,{jobId:second.id,apiKey:secret})).status,'failed');
  const third=await ai.jobs.start(owner,{models});await ai.disconnect(owner);
  assert.equal((await ai.jobs.run(owner,{jobId:third.id,apiKey:secret})).status,'failed');
  assert.equal((await ai.status(owner)).aiConfigured,false);assert.equal(calls,0);
});

test('quota, timeout and malformed output keep the prior verified connection and expose only safe diagnostics',async()=>{
  let mode='ok',calls=0;const {ai,vault,blobs}=await fixture(async()=>{
    calls++;
    if(mode==='quota')return Response.json({error:{message:secret}},{status:429});
    if(mode==='timeout')throw Object.assign(new Error(secret),{name:'TimeoutError'});
    if(mode==='invalid')return Response.json({candidates:[{content:{parts:[{text:secret}]}}]});
    return ok();
  });
  await ai.connect(owner,{apiKey:secret,model:models[0]});const previous=await vault.getJSON(settingKey);
  for(const [failure,kind] of [['quota','quota'],['timeout','timeout'],['invalid','response']]) {
    mode=failure;const job=await ai.jobs.start(owner,{models});const before=calls;
    const result=await ai.jobs.run(owner,{jobId:job.id,apiKey:'replacement-synthetic-key'});
    assert.equal(result.status,'failed');assert.equal(result.diagnostic.kind,kind);assert.equal(calls,before+1);
    assert.deepEqual(await vault.getJSON(settingKey),previous);assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(await vault.getJSON(jobKey)).includes(secret));
  }
  assert.ok(!JSON.stringify([...blobs.rows]).includes(secret));assert.equal((await ai.status(owner)).aiConfigured,true);
});

test('automatic fallback shares one deadline, manual selection keeps its model and completion recovers a lost status write',async()=>{
  let calls=[];const {ai,vault}=await fixture(async(url,options)=>{
    calls.push({url,signal:options.signal});return url.includes('retired') ? new Response(null,{status:404}) : ok();
  });
  const job=await ai.jobs.start(owner,{models:['gemini-retired-flash','gemini-2.5-flash'],modelSelection:'auto'});
  const result=await ai.jobs.run(owner,{jobId:job.id,apiKey:secret});assert.equal(result.connection.model,'gemini-2.5-flash');
  assert.equal(calls.length,2);assert.equal(calls[0].signal,calls[1].signal);
  const manual=await ai.jobs.start(owner,{models:[' models/gemini-fixture-pro '],modelSelection:'manual'});
  const originalWrite=vault.setJSON;let failedStatus=false;
  vault.setJSON=async(key,value)=>{if(key===jobKey && value.status==='succeeded' && !failedStatus){failedStatus=true;throw new Error('Transient status write');}return originalWrite(key,value);};
  assert.equal((await ai.jobs.run(owner,{jobId:manual.id,apiKey:secret})).status,'succeeded');
  const status=await ai.status(owner);assert.equal(status.job.status,'succeeded');assert.equal(status.model,'gemini-fixture-pro');assert.equal(status.modelSelection,'manual');
  assert.equal(calls.length,3);assert.equal((await ai.jobs.run(owner,{jobId:manual.id,apiKey:secret})).status,'succeeded');assert.equal(calls.length,3);
});

test('known Flash probes minimize thinking while unknown families retain a safe output budget',async()=>{
  for(const [model,thinking,maxTokens] of [
    ['gemini-2.5-flash',{thinkingBudget:0},256],['gemini-3-flash-preview',{thinkingLevel:'minimal'},256],
    ['gemini-3.1-flash-lite',{thinkingLevel:'minimal'},256],['gemini-9-flash',undefined,2048],
  ]) await verifyGeminiConnection({apiKey:secret,requestedModel:model,fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);assert.deepEqual(body.generationConfig.thinkingConfig,thinking);assert.equal(body.generationConfig.maxOutputTokens,maxTokens);
    assert.equal(body.contents[0].parts[0].text,'Return exactly {"ok":true} as JSON.');return ok();
  }});
  assert.equal(readAiDiagnostic({stage:'probe',kind:'timeout',elapsedMs:90004}).elapsedMs,90004);
});

test('Netlify sends the worker route to a background function before the generic API and keeps previews isolated',async()=>{
  assert.equal(workerConfig.background,true);
  const toml=await readFile(new URL('../netlify.toml',import.meta.url),'utf8');
  assert.ok(toml.indexOf('from = "/api/ai/connect/run"')<toml.indexOf('from = "/api/*"'));
  assert.match(toml,/from = "\/api\/ai\/connect\/run"\s+to = "\/\.netlify\/functions\/career-ai-background"/);
  for(const context of ['deploy-preview','branch-deploy']) assert.match(toml,new RegExp('\\[context\\.'+context+'\\][\\s\\S]*?functions = "netlify/preview-functions"'));
});
