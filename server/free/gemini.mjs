import {readAiDiagnostic} from '../../shared/ai-diagnostic.mjs';
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
export const validGeminiModel = value => typeof value === 'string' && /^gemini-[A-Za-z0-9._-]{1,120}$/.test(value);

export function aiFailureMessage(status) {
  if ([400,401,403].includes(status)) return 'Gemini API 키 또는 사용 권한을 확인해 주세요. 백업 및 설정에서 다시 연결할 수 있습니다.';
  if (status === 429) return 'Gemini 사용 한도에 도달했습니다. 잠시 후 다시 분석하거나 Google AI Studio에서 한도를 확인해 주세요.';
  if ([404,410].includes(status)) return '선택한 Gemini 모델을 사용할 수 없습니다. 백업 및 설정에서 자동 선택으로 다시 연결해 주세요.';
  return 'Gemini가 응답하지 않았습니다. 잠시 후 다시 분석해 주세요.';
}

export function geminiGenerationConfig(model, options) {
  return { ...options, ...(model.startsWith('gemini-2.5-flash') ? {thinkingConfig:{thinkingBudget:0}} : {}) };
}

function transportKind(error, signal) {
  const causes = [], pending = [error];
  while (pending.length && causes.length < 8) {
    const next = pending.shift();
    if (!next || typeof next !== 'object' || causes.includes(next)) continue;
    causes.push(next);pending.push(next.cause,...(Array.isArray(next.errors) ? next.errors.slice(0,4) : []));
  }
  if (signal.aborted || causes.some(e => ['TimeoutError','AbortError'].includes(e.name) || e.status === 504
    || ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(e.code))) return 'timeout';
  if (causes.some(e => ['ENOTFOUND','EAI_AGAIN'].includes(e.code))) return 'dns';
  if (causes.some(e => ['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID'].includes(e.code))) return 'tls';
  return 'network';
}

function connectionFailure(stage, kind, startedAt, httpStatus) {
  const action = stage === 'models' ? '모델 목록을 조회하는 중' : 'AI 분석 응답을 확인하는 중';
  const messages = {
    timeout:`${action} 응답 대기 시간이 초과되었습니다. 키를 다시 발급받지 말고 아래 오류 정보를 확인해 주세요.`,
    dns:'앱 서버에서 Google 서버 주소를 찾지 못했습니다. 아래 오류 정보를 전달해 주세요.',
    tls:'앱 서버와 Google 사이의 보안 연결을 확인하지 못했습니다. 아래 오류 정보를 전달해 주세요.',
    network:'앱 서버와 Google 사이의 네트워크 연결이 끊겼습니다. 아래 오류 정보를 전달해 주세요.',
    auth:aiFailureMessage(httpStatus || 403), quota:aiFailureMessage(429), model:aiFailureMessage(404),
    service:`${action} Google 서버 오류가 발생했습니다. 잠시 후 다시 연결해 주세요.`,
    response:`${action} 올바른 분석 응답을 받지 못했습니다. 아래 오류 정보를 확인해 주세요.`,
  };
  return Object.assign(fault(messages[kind],kind === 'timeout' ? 504 : kind === 'quota' ? 429 : kind === 'auth' || kind === 'model' ? 400 : 502),{
    diagnostic:readAiDiagnostic({stage,kind,elapsedMs:Math.min(60000,Math.max(0,Date.now()-startedAt)),httpStatus}),
  });
}

async function requestJson(url, {apiKey,fetcher,signal,stage,startedAt,options={}}) {
  let response;
  try { response = await fetcher(url,{...options,headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},signal}); }
  catch(error) { throw connectionFailure(stage,transportKind(error,signal),startedAt); }
  if (!response.ok) {
    const status = response.status;
    const kind = [400,401,403].includes(status) ? 'auth' : status === 429 ? 'quota' : [404,410].includes(status) ? 'model' : [408,504].includes(status) ? 'timeout' : 'service';
    throw connectionFailure(stage,kind,startedAt,status);
  }
  try { return await response.json(); }
  catch(error) { throw connectionFailure(stage,error instanceof SyntaxError ? 'response' : transportKind(error,signal),startedAt,response.status); }
}

function automaticCandidates(models) {
  const names = [...new Set(models.filter(model =>
    Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent')
  ).map(model => typeof model.name === 'string' ? model.name.replace(/^models\//,'') : '').filter(name =>
    validGeminiModel(name) && /-flash(?:-|$)/.test(name)
    && !/(?:image|audio|tts|live|embedding|robotics|computer-use|deep-research)/i.test(name)
  ))];
  const stability = name => /(?:preview|exp)(?:-|$)/.test(name) ? 2 : /latest/.test(name) ? 1 : 0;
  const version = name => {
    const match = /^gemini-(\d+)(?:\.(\d+))?/.exec(name);
    return [Number(match?.[1] || 0), Number(match?.[2] || 0)];
  };
  return names.sort((a,b) => stability(a)-stability(b)
    || version(b)[0]-version(a)[0] || version(b)[1]-version(a)[1]
    || Number(!a.includes('flash-lite'))-Number(!b.includes('flash-lite'))
    || a.localeCompare(b));
}

// The UI calls discovery and verification in separate authenticated requests,
// so a slow catalog request cannot consume the generation request's budget.
export async function discoverGeminiModels({apiKey,fetcher,signal=AbortSignal.timeout(15000)}) {
  const startedAt = Date.now(), models = [], seenTokens = new Set();
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({pageSize:'1000', ...(pageToken ? {pageToken} : {})});
    const data = await requestJson(`${baseUrl}/models?${params}`,{apiKey,fetcher,signal,stage:'models',startedAt});
    if (!Array.isArray(data?.models)) throw connectionFailure('models','response',startedAt);
    models.push(...data.models.filter(model => model && typeof model === 'object'));
    if (!data.nextPageToken) break;
    if (typeof data.nextPageToken !== 'string' || data.nextPageToken.length > 4096 || seenTokens.has(data.nextPageToken)) throw connectionFailure('models','response',startedAt);
    seenTokens.add(data.nextPageToken); pageToken = data.nextPageToken;
  }
  const candidates = automaticCandidates(models).slice(0,3);
  if (!candidates.length) throw Object.assign(fault('이 키에서 문서 분석용 Gemini Flash 모델을 찾지 못했습니다. Google AI Studio에서 프로젝트의 사용 가능한 모델과 권한을 확인해 주세요.'),{diagnostic:readAiDiagnostic({stage:'models',kind:'model',elapsedMs:Date.now()-startedAt})});
  return candidates;
}

// Only an actual successful JSON response permits persistence. The older
// combined auto request remains supported with its original bounded deadline.
export async function verifyGeminiConnection({apiKey, requestedModel, fetcher}) {
  if (requestedModel != null && typeof requestedModel !== 'string') throw fault('Gemini 모델 이름을 확인해 주세요.');
  const requested = (requestedModel || '').trim().replace(/^models\//,'');
  const automatic = !requested || requested === 'auto';
  if (!automatic && !validGeminiModel(requested)) throw fault('Gemini 모델 이름을 확인해 주세요.');
  const signal = AbortSignal.timeout(automatic ? 18000 : 24000);
  let candidates = [requested];
  if (automatic) candidates = await discoverGeminiModels({apiKey,fetcher,signal});
  const startedAt = Date.now();
  let lastFailure = connectionFailure('probe','response',startedAt);
  for (const model of candidates) {
    let data;
    try { data = await requestJson(`${baseUrl}/models/${model}:generateContent`, {apiKey,fetcher,signal,stage:'probe',startedAt,options:{
      method:'POST',
      body:JSON.stringify({contents:[{role:'user',parts:[{text:'Return exactly {"ok":true} as JSON.'}]}],
        generationConfig:geminiGenerationConfig(model,{responseMimeType:'application/json',maxOutputTokens:2048,temperature:0})}),
    }}); } catch(error) {
      if (automatic && error.diagnostic?.kind === 'model') { lastFailure=error;continue; }
      throw error;
    }
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.filter(part => part && !part.thought && typeof part.text === 'string').map(part => part.text).join('') : '';
    let verified = false;
    try { verified = JSON.parse(text || '')?.ok === true; } catch { /* No key is saved for non-JSON output. */ }
    if (verified) return {model, modelSelection:automatic ? 'auto' : 'manual'};
    lastFailure = connectionFailure('probe','response',startedAt);
  }
  throw lastFailure;
}
