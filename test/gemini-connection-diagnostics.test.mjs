import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverGeminiModels,verifyGeminiConnection} from '../server/free/gemini.mjs';
import {createFreeApi} from '../server/free/api.mjs';
import {readAiDiagnostic} from '../shared/ai-diagnostic.mjs';

const apiKey='synthetic-diagnostics-secret-never-real';
const listed=()=>Response.json({models:[{name:'models/gemini-fixture-flash',supportedGenerationMethods:['generateContent']}]});
const ok=()=>Response.json({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]});

test('transport failures identify catalog versus generation stages without exposing raw errors or credentials',async()=>{
  for(const [cause,kind] of [
    [{name:'TimeoutError'},'timeout'],[{name:'AbortError'},'timeout'],[{status:504},'timeout'],
    [{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}},'timeout'],[{cause:{code:'ETIMEDOUT'}},'timeout'],
    [{cause:{code:'ENOTFOUND'}},'dns'],[{errors:[{code:'EAI_AGAIN'}]},'dns'],
    [{cause:{code:'ERR_TLS_CERT_ALTNAME_INVALID'}},'tls'],[{cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}},'tls'],
    [{cause:{code:'ECONNRESET'}},'network'],
  ])for(const stage of ['models','probe']) {
    const fetcher=async()=>{throw Object.assign(new Error('Raw URL, key and private text '+apiKey),cause);};
    const promise=stage==='models' ? discoverGeminiModels({apiKey,fetcher}) : verifyGeminiConnection({apiKey,requestedModel:'gemini-fixture-flash',fetcher});
    await assert.rejects(promise,error=>{
      assert.equal(error.diagnostic.code,`GEMINI_${stage.toUpperCase()}_${kind.toUpperCase()}`);
      assert.ok(!JSON.stringify(error).includes(apiKey));assert.ok(!error.message.includes(apiKey));
      return kind==='timeout' ? error.status===504 : error.status===502;
    });
  }
});

test('body timeouts and provider errors retain safe stage/status diagnostics while unrelated metadata is discarded',async()=>{
  await assert.rejects(discoverGeminiModels({apiKey,fetcher:async()=>({ok:true,status:200,json:async()=>{throw Object.assign(new Error(apiKey),{name:'AbortError'});}})}),error=>error.diagnostic.code==='GEMINI_MODELS_TIMEOUT');
  for(const [status,kind] of [[403,'auth'],[429,'quota'],[503,'service'],[504,'timeout']]){
    await assert.rejects(verifyGeminiConnection({apiKey,requestedModel:'gemini-fixture-flash',fetcher:async()=>Response.json({error:{message:apiKey}},{status})}),error=>error.diagnostic.kind===kind && error.diagnostic.httpStatus===status && !error.message.includes(apiKey));
  }
  const diagnostic=readAiDiagnostic({stage:'probe',kind:'timeout',code:apiKey,elapsedMs:23000,httpStatus:504,apiKey,message:apiKey,prompt:apiKey});
  assert.deepEqual(diagnostic,{code:'GEMINI_PROBE_TIMEOUT',stage:'probe',kind:'timeout',elapsedMs:23000,httpStatus:504});
  assert.equal(readAiDiagnostic({stage:apiKey,kind:'timeout'}),null);assert.equal(readAiDiagnostic({stage:'probe',kind:apiKey}),null);
});

test('owner-only catalog lookup is a separate non-writing request and only the later successful probe stores a connection',async()=>{
  const config={appUrl:'https://record.example',ownerEmail:'owner@example.test',projectId:'record-test',firebaseWebApiKey:'fixture-web-key',driveEnabled:false};
  const user={uid:'fixture-owner',email:config.ownerEmail,token:'fixture-owner-token'};
  let stored=null,writes=0,failProbe=false;const calls=[],logs=[];
  const vault={getJSON:async()=>stored,setJSON:async(_key,value)=>{stored=value;writes++;},acquireLease:async()=>async()=>{}};
  const handler=createFreeApi({config,vault,logger:(...values)=>logs.push(values),auth:{identify:async request=>{if(request.headers.get('authorization')!=='Bearer fixture-owner')throw Object.assign(new Error('로그인 필요'),{status:401});return user;}},repositoryFactory:()=>{throw new Error('Archive must remain untouched');},fetcher:async(url,options)=>{
    calls.push({url,signal:options.signal});
    if(new URL(url).pathname==='/v1beta/models')return listed();
    if(failProbe)throw Object.assign(new Error('Do not log '+apiKey),{cause:{code:'ETIMEDOUT'}});
    return ok();
  }});
  const request=(path,body,headers={})=>new Request(config.appUrl+path,{method:'POST',headers:{Origin:config.appUrl,Authorization:'Bearer fixture-owner','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await handler.handle(request('/api/ai/models',{apiKey},{Authorization:''}))).status,401);
  assert.equal((await handler.handle(request('/api/ai/models',{apiKey},{Origin:'https://other.example'}))).status,403);assert.equal(calls.length,0);
  const catalog=await (await handler.handle(request('/api/ai/models',{apiKey}))).json();assert.deepEqual(catalog,{models:['gemini-fixture-flash']});assert.equal(writes,0);assert.equal(stored,null);assert.equal(calls.length,1);
  const connect=()=>new Request(config.appUrl+'/api/ai/settings',{method:'PUT',headers:{Origin:config.appUrl,Authorization:'Bearer fixture-owner','Content-Type':'application/json'},body:JSON.stringify({apiKey,model:catalog.models[0],modelSelection:'auto'})});
  const response=await handler.handle(connect());assert.equal(response.status,200);assert.equal(writes,1);assert.equal(stored.modelSelection,'auto');assert.equal(calls.length,2);assert.notEqual(calls[0].signal,calls[1].signal);
  const previous=structuredClone(stored);failProbe=true;const failed=await handler.handle(connect());assert.equal(failed.status,504);
  const error=await failed.json();assert.equal(error.diagnostic.code,'GEMINI_PROBE_TIMEOUT');assert.equal(writes,1);assert.deepEqual(stored,previous);assert.ok(!JSON.stringify(logs).includes(apiKey));assert.ok(!JSON.stringify(error).includes(apiKey));assert.equal(logs.at(-1)[1].code,'GEMINI_PROBE_TIMEOUT');
});
