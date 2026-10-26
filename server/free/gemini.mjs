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

// Discovery and synthetic JSON probes share one deadline. Only an actual
// successful response permits persistence. Never guess a replacement model ID,
// retry quota/auth errors, send private documents, or return provider error text.
export async function verifyGeminiConnection({apiKey, requestedModel, fetcher}) {
  if (requestedModel != null && typeof requestedModel !== 'string') throw fault('Gemini 모델 이름을 확인해 주세요.');
  const requested = (requestedModel || '').trim().replace(/^models\//,'');
  const automatic = !requested || requested === 'auto';
  if (!automatic && !validGeminiModel(requested)) throw fault('Gemini 모델 이름을 확인해 주세요.');
  const signal = AbortSignal.timeout(18000);
  const headers = {'Content-Type':'application/json','x-goog-api-key':apiKey};
  async function request(url, options = {}) {
    try { return await fetcher(url, {...options,headers,signal}); }
    catch { throw fault('Gemini에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',502); }
  }
  let candidates = [requested];
  if (automatic) {
    const models = [], seenTokens = new Set();
    let pageToken = '';
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({pageSize:'1000', ...(pageToken ? {pageToken} : {})});
      const response = await request(`${baseUrl}/models?${params}`);
      if (!response.ok) throw fault([400,401,403,429].includes(response.status) ? aiFailureMessage(response.status) : 'Google의 모델 목록을 불러오지 못했습니다. 잠시 후 다시 연결해 주세요.', response.status === 429 ? 429 : 502);
      const data = await response.json().catch(() => null);
      if (!Array.isArray(data?.models)) throw fault('Google의 모델 목록을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.',502);
      models.push(...data.models.filter(model => model && typeof model === 'object'));
      if (!data.nextPageToken) break;
      if (typeof data.nextPageToken !== 'string' || data.nextPageToken.length > 4096 || seenTokens.has(data.nextPageToken)) throw fault('Google의 모델 목록을 끝까지 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.',502);
      seenTokens.add(data.nextPageToken); pageToken = data.nextPageToken;
    }
    candidates = automaticCandidates(models).slice(0,3);
    if (!candidates.length) throw fault('이 키에서 문서 분석용 Gemini Flash 모델을 찾지 못했습니다. Google AI Studio에서 프로젝트의 사용 가능한 모델과 권한을 확인해 주세요.');
  }
  let lastFailure = '사용 가능한 Gemini 모델의 응답을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.';
  for (const model of candidates) {
    const response = await request(`${baseUrl}/models/${model}:generateContent`, {
      method:'POST',
      body:JSON.stringify({contents:[{role:'user',parts:[{text:'Return exactly {"ok":true} as JSON.'}]}],
        generationConfig:geminiGenerationConfig(model,{responseMimeType:'application/json',maxOutputTokens:2048,temperature:0})}),
    });
    if (!response.ok) {
      if (automatic && [404,410].includes(response.status)) { lastFailure = 'Google이 안내한 모델에 연결하지 못했습니다. 잠시 후 다시 연결해 주세요.'; continue; }
      throw fault(aiFailureMessage(response.status), response.status === 429 ? 429 : 400);
    }
    const data = await response.json().catch(() => null);
    const text = data?.candidates?.[0]?.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    let verified = false;
    try { verified = JSON.parse(text || '')?.ok === true; } catch { /* No key is saved for non-JSON output. */ }
    if (verified) return {model, modelSelection:automatic ? 'auto' : 'manual'};
    lastFailure = 'Gemini의 문서 분석용 JSON 응답을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.';
  }
  throw fault(lastFailure,502);
}
