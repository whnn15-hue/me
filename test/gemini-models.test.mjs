import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyGeminiConnection} from '../server/free/gemini.mjs';
import {createAiSettings} from '../server/free/ai-settings.mjs';
import {freeAnalyze} from '../server/free/analyze.mjs';

const apiKey = 'synthetic-discovery-key-not-real';
const row = (name, methods=['generateContent']) => ({name:`models/${name}`,supportedGenerationMethods:methods});
const listed = models => Response.json({models});
const ok = () => Response.json({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]});

test('automatic setup discovers current Flash models across pages, excludes specialized/Pro models and verifies JSON output',async()=>{
  const calls=[];
  const result=await verifyGeminiConnection({apiKey,requestedModel:'auto',fetcher:async(url,options)=>{
    calls.push(url);assert.ok(!url.includes(apiKey));assert.equal(options.headers['x-goog-api-key'],apiKey);assert.ok(options.signal);
    const parsed=new URL(url);
    if(parsed.pathname==='/v1beta/models' && !parsed.searchParams.has('pageToken')) return Response.json({models:[row('gemini-9-pro'),row('gemini-9-flash-image'),row('gemini-9-flash', ['embedContent']),row('gemini-10-flash-preview'),null],nextPageToken:'next/opaque+page'});
    if(parsed.pathname==='/v1beta/models') {
      assert.equal(parsed.searchParams.get('pageToken'),'next/opaque+page');
      return listed([row('gemini-9-flash-native-audio'),row('gemini-9-flash-tts'),row('gemini-9-flash'),row('gemini-9-flash-lite'),row('gemini-9-flash-lite'),row('https://other.invalid/model')]);
    }
    assert.equal(parsed.pathname,'/v1beta/models/gemini-9-flash-lite:generateContent');
    const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');
    assert.deepEqual(body.contents,[{role:'user',parts:[{text:'Return exactly {"ok":true} as JSON.'}]}]);
    assert.ok(!('thinkingConfig' in body.generationConfig));return ok();
  }});
  assert.deepEqual(result,{model:'gemini-9-flash-lite',modelSelection:'auto'});assert.equal(calls.length,3);
});

test('retired listed model falls back to another advertised model and the selected ID is used for later document analysis',async()=>{
  const attempted=[], values=new Map();const vault={getJSON:async key=>values.get(key),setJSON:async(key,value)=>values.set(key,value),acquireLease:async()=>async()=>{}};
  const owner={uid:'fixture',email:'owner@example.test'};
  const fetcher=async(url,options)=>{
    if(new URL(url).pathname==='/v1beta/models')return listed([row('gemini-9-flash-lite'),row('gemini-9-flash')]);
    attempted.push(url);assert.equal(values.size,0);
    return url.includes('flash-lite:') ? new Response(null,{status:404}) : ok();
  };
  const ai=createAiSettings({vault,config:{ownerEmail:owner.email},fetcher});
  const result=await ai.connect(owner,{apiKey});assert.equal(result.model,'gemini-9-flash');assert.equal(attempted.length,2);
  const config=await ai.resolve(owner);assert.equal(config.geminiModel,'gemini-9-flash');assert.equal(config.modelSelection,'auto');
  const analyzed=await freeAnalyze({text:'가상 기관의 가상 강의',config,fetcher:async(url)=>{
    assert.match(url,/\/gemini-9-flash:generateContent$/);
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({careers:[{title:'가상 강의'}]})}]}}]});
  }});assert.equal(analyzed.method,'ai');
});

test('model discovery never saves new credentials on auth, quota, missing models, invalid JSON or transport failure',async()=>{
  const owner={uid:'fixture',email:'owner@example.test'}, previous={apiKey:'working-old-key',model:'gemini-old-flash'};
  for(const scenario of ['list-auth','list-quota','no-general-flash','probe-auth','probe-quota','all-retired','not-json','network']){
    let stored=structuredClone(previous), writes=0, probes=0, releases=0;
    const vault={getJSON:async()=>stored,setJSON:async(_key,value)=>{writes++;stored=value;},acquireLease:async()=>async()=>{releases++;}};
    const ai=createAiSettings({vault,config:{ownerEmail:owner.email},fetcher:async(url)=>{
      if(scenario==='network')throw new Error('network failure with secret '+apiKey);
      if(new URL(url).pathname==='/v1beta/models'){
        if(scenario==='list-auth')return new Response(null,{status:403});
        if(scenario==='list-quota')return new Response(null,{status:429});
        return listed(scenario==='no-general-flash' ? [row('gemini-9-pro'),row('gemini-9-flash-image')] : [row('gemini-9-flash-lite'),row('gemini-9-flash')]);
      }
      probes++;
      if(scenario==='probe-auth')return new Response(null,{status:403});
      if(scenario==='probe-quota')return new Response(null,{status:429});
      if(scenario==='all-retired')return new Response(null,{status:404});
      return Response.json({candidates:[{content:{parts:[{thought:true,text:'{"ok":true}'},{text:'OK'}]}}]});
    }});
    await assert.rejects(ai.connect(owner,{apiKey,model:'auto'}),error=>!error.message.includes(apiKey) && (scenario.includes('quota') ? error.status===429 && /한도/.test(error.message) : /[가-힣]/.test(error.message)));
    assert.equal(writes,0,scenario);assert.deepEqual(stored,previous);assert.equal(releases,1);
    if(scenario==='probe-auth' || scenario==='probe-quota')assert.equal(probes,1);
    if(scenario.startsWith('list-') || scenario==='no-general-flash' || scenario==='network')assert.equal(probes,0);
  }
});

test('manual model honors explicit choice, accepts models/ prefix and does not silently substitute another model',async()=>{
  let calls=0;
  const fetcher=async(url)=>{calls++;assert.match(url,/\/gemini-fixture-flash:generateContent$/);return new Response(null,{status:404});};
  await assert.rejects(verifyGeminiConnection({apiKey,requestedModel:' models/gemini-fixture-flash ',fetcher}),error=>/자동 선택/.test(error.message));assert.equal(calls,1);
  for(const model of ['https://other.invalid/model','gemini-a/../../other',{},'gemini-a?key=x'])await assert.rejects(verifyGeminiConnection({apiKey,requestedModel:model,fetcher}));
  assert.equal(calls,1);
});

test('discovery has a finite probe and pagination budget and rejects malformed listings',async()=>{
  let probes=0;
  await assert.rejects(verifyGeminiConnection({apiKey,fetcher:async(url)=>{
    if(new URL(url).pathname==='/v1beta/models')return listed(Array.from({length:10},(_,index)=>row(`gemini-9-flash-${index}`)));
    probes++;return new Response(null,{status:410});
  }}));assert.equal(probes,3);
  let pages=0;
  await assert.rejects(verifyGeminiConnection({apiKey,fetcher:async()=>{pages++;return Response.json({models:[],nextPageToken:'repeated'});}}));assert.equal(pages,2);
  await assert.rejects(verifyGeminiConnection({apiKey,fetcher:async()=>Response.json({unexpected:'payload'})}),error=>/목록/.test(error.message));
});
