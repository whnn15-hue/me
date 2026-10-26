import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiSettings} from '../server/free/ai-settings.mjs';
import {createPrivateVault} from '../server/free/vault.mjs';
import {createFreeApi} from '../server/free/api.mjs';
import {freeAnalyze} from '../server/free/analyze.mjs';
import {normalizeGeminiKey} from '../shared/gemini-key.mjs';
class MemoryBlobs {
  constructor(){this.rows=new Map();this.version=0;}
  async get(key){return this.rows.get(key)?.data ?? null;}
  async getWithMetadata(key){return this.rows.get(key) ?? null;}
  async setJSON(key,data,condition={}){const old=this.rows.get(key);if(condition.onlyIfNew && old || condition.onlyIfMatch && condition.onlyIfMatch!==old?.etag)return {modified:false};this.rows.set(key,{data:structuredClone(data),etag:String(++this.version)});return {modified:true};}
  async delete(key){this.rows.delete(key);}
}
const config={appUrl:'https://record.example',ownerEmail:'owner@example.com',projectId:'record-test',firebaseWebApiKey:'web-key',driveEnabled:false,aiEnabled:false};
const owner={uid:'owner-one',email:config.ownerEmail,name:'테스트',token:'owner-token'};
const secret='synthetic-key-only-never-a-real-key-12345';
const probeResponse=()=>Response.json({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]});
const withModelListing=fetcher=>(url,options)=>new URL(url).pathname==='/v1beta/models' ? Promise.resolve(Response.json({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']}]})) : fetcher(url,options);
const answer=careers=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify({careers,warnings:['역할 확인']})}]}}]});

test('key input preserves opaque tokens, normalizes clipboard wrappers and rejects unsafe input without revealing it',()=>{
  for(const key of ['AIza'+'a'.repeat(35),'synthetic.'+'a'.repeat(300)+'/+=_-','short', 'a'.repeat(4096)]) {
    assert.equal(normalizeGeminiKey(key),key);
    assert.equal(normalizeGeminiKey(' \n"'+key+'"\n '),key);
    assert.equal(normalizeGeminiKey('‘'+key+'’'),key);
  }
  for(const value of [null,{},'', ' '.repeat(20),'a'.repeat(4097),'redacted****value','redacted...value','redacted…value','••••','key with space','key\r\nX-Injected:1','key\u0000value','key\u200bvalue','프로젝트 이름']) {
    assert.throws(()=>normalizeGeminiKey(value),error=>/[가-힣]/.test(error.message) && (typeof value!=='string' || !value || !error.message.includes(value)));
  }
});

test('long keys and punctuation reach provider verification intact and rejected replacements never overwrite the working key',async()=>{
  const vault=await createPrivateVault(new MemoryBlobs()), opaque='synthetic.'+'A'.repeat(300)+'/+=_end';let reject=false;const sent=[];
  const ai=createAiSettings({vault,config,fetcher:withModelListing(async(url,options)=>{
    sent.push(new Headers(options.headers).get('x-goog-api-key'));
    return reject ? Response.json({error:{message:'Do not echo rejected credential: '+opaque}},{status:400}) : probeResponse();
  })});
  assert.equal((await ai.connect(owner,{apiKey:' "'+opaque+'" '})).aiConfigured,true);assert.deepEqual(sent,[opaque]);
  assert.equal((await ai.resolve(owner)).geminiKey,opaque);
  reject=true;await assert.rejects(ai.connect(owner,{apiKey:'different.opaque-key'}),error=>error.status===400 && !error.message.includes(opaque));
  assert.equal((await ai.resolve(owner)).geminiKey,opaque);
  for(const apiKey of ['masked...value','bad\r\nheader','A'.repeat(4097)]) await assert.rejects(ai.connect(owner,{apiKey}),error=>error.status===400);
  assert.equal(sent.length,2);assert.ok(!JSON.stringify(await ai.status(owner)).includes(opaque));
});

test('owner AI settings validate before encrypted storage, keep working keys on failure and disconnect without exposing secrets',async()=>{
  const blobs=new MemoryBlobs(), vault=await createPrivateVault(blobs);let status=200,calls=0;
  const ai=createAiSettings({vault,config,fetcher:withModelListing(async(url,options)=>{calls++;assert.match(url,/^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/gemini-2.5-flash:generateContent$/);assert.equal(options.headers['x-goog-api-key'],secret);assert.ok(!options.body.includes('owner-token'));return status===200 ? probeResponse() : new Response(null,{status});})});
  assert.equal((await ai.status(owner)).aiConfigured,false);
  await assert.rejects(ai.connect({...owner,email:'other@example.com'},{apiKey:secret}),e=>e.status===403);
  await assert.rejects(ai.connect(owner,{apiKey:secret,model:'https://attacker.invalid/model'}));assert.equal(calls,0);
  const connected=await ai.connect(owner,{apiKey:secret});assert.equal(connected.aiConfigured,true);
  assert.ok(!JSON.stringify(connected).includes(secret));assert.ok(!JSON.stringify([...blobs.rows]).includes(secret));
  assert.equal((await ai.resolve(owner)).geminiKey,secret);
  status=429;await assert.rejects(ai.connect(owner,{apiKey:secret}),e=>e.status===429 && /한도/.test(e.message));
  assert.equal((await ai.resolve(owner)).geminiKey,secret);
  const disabled=await ai.disconnect(owner);assert.equal(disabled.aiConfigured,false);assert.equal((await ai.resolve(owner)).geminiKey,'');
  assert.ok(!JSON.stringify(await vault.getJSON('aiSettings/owner-one')).includes(secret));
});

test('free API owner-only connection, status, analysis and disconnect work without touching archive storage',async()=>{
  const vault=await createPrivateVault(new MemoryBlobs());let probe=true,calls=0;
  const api=createFreeApi({vault,config,auth:{identify:async req=>{if(req.headers.get('authorization')!=='Bearer synthetic-owner') throw Object.assign(new Error('로그인 필요'),{status:401});return owner;}},repositoryFactory:()=>{throw new Error('archive must not be read for text analysis/settings');},fetcher:withModelListing(async()=>{calls++;return probe ? probeResponse() : answer([{title:'가상 연수 강의',organization:'가상 연수원',role:'강사',category:'강의·연수',startDate:'2026-05',datePrecision:'month',tags:['교육']}]);})});
  const request=(path,method='GET',body,headers={})=>new Request(config.appUrl+path,{method,headers:{Origin:config.appUrl,Authorization:'Bearer synthetic-owner','Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await api.handle(request('/api/ai/settings','GET',null,{Authorization:''}))).status,401);
  assert.equal((await api.handle(request('/api/ai/settings','PUT',{apiKey:secret},{Origin:'https://other.example'}))).status,403);
  assert.equal((await api.handle(request('/api/ai/settings','PUT',{apiKey:secret}))).status,200);assert.equal(calls,1);
  const settings=await (await api.handle(request('/api/ai/settings'))).json();assert.equal(settings.aiConfigured,true);assert.ok(!JSON.stringify(settings).includes(secret));
  probe=false;const result=await (await api.handle(request('/api/analyze','POST',{text:'2026년 5월 가상 연수원 강사 활동'}))).json();assert.equal(result.method,'ai');assert.equal(result.careers[0].role,'강사');assert.equal(result.careers[0].verified,false);
  await api.handle(request('/api/ai/settings','DELETE'));assert.equal((await (await api.handle(request('/api/ai/settings'))).json()).aiConfigured,false);
  assert.equal((await (await api.handle(request('/api/analyze','POST',{text:'활동'}))).json()).method,'rules');assert.equal(calls,2);
});

test('Gemini can read scanned originals while untrusted fields and unrelated IDs never enter drafts',async()=>{
  const doc={id:'owned-document',name:'공문.pdf',mime:'application/pdf',text:''};
  const input={title:'가상 강의',organization:{invalid:true},role:'강사',category:'강의·연수',startDate:'2026',tags:['교육',null],id:'malicious-id',documentIds:['another-document'],verified:true,awardStages:['본선','not-valid']};
  const result=await freeAnalyze({document:doc,buffer:Buffer.from('%PDF-synthetic'),config:{aiEnabled:true,geminiKey:secret},fetcher:async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[1].inlineData.mimeType,'application/pdf');assert.equal(Buffer.from(body.contents[0].parts[1].inlineData.data,'base64').toString(),'%PDF-synthetic');return answer([input]);}});
  assert.equal(result.method,'ai');const row=result.careers[0];assert.equal(row.verified,false);assert.equal(row.organization,'');assert.deepEqual(row.documentIds,['owned-document']);assert.notEqual(row.id,'malicious-id');assert.deepEqual(row.tags,['교육']);
});

test('quota failures, invalid output, unreadable formats and disabled AI produce honest reviewable fallback',async()=>{
  const base={text:'2026년 가상 교사 강의',config:{aiEnabled:true,geminiKey:secret}};
  const quota=await freeAnalyze({...base,fetcher:async()=>new Response(null,{status:429})});assert.equal(quota.method,'rules');assert.equal(quota.issue,'quota');assert.match(quota.warnings.join(' '),/한도/);assert.ok(!quota.warnings.join(' ').includes('미연결'));
  const invalid=await freeAnalyze({...base,fetcher:async()=>answer([{title:'수업',startDate:'2026-02-30'}])});assert.equal(invalid.method,'rules');
  const unreadable=await freeAnalyze({...base,text:'',document:{id:'hwp',name:'공문.hwp',mime:'application/x-hwp'},buffer:Buffer.from('HWP'),fetcher:async()=>{throw new Error('must not call');}});assert.equal(unreadable.issue,'unreadable');
  const off=await freeAnalyze({...base,config:{aiEnabled:false,geminiKey:secret},fetcher:async()=>{throw new Error('must not call');}});assert.equal(off.method,'rules');assert.equal(off.warnings.length,1);
});
