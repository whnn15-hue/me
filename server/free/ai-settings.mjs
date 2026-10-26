import { aiFailureMessage } from './analyze.mjs';

const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const defaultModel = 'gemini-2.5-flash';
const validModel = value => typeof value === 'string' && /^gemini-[A-Za-z0-9.-]{1,80}$/.test(value);

// Same encrypted, server-only vault as Drive. Keys never enter Firestore,
// archive backups, status JSON or browser storage.
export function createAiSettings({ vault, config, fetcher }) {
  function keyFor(user) {
    if (!user?.uid || typeof user.uid !== 'string' || !/^[^/\u0000-\u001f]{1,128}$/.test(user.uid)
      || !config.ownerEmail || user.email?.toLowerCase() !== config.ownerEmail.toLowerCase()) throw fault('본인 계정으로 로그인해 주세요.', 403);
    return `aiSettings/${user.uid}`;
  }
  async function resolve(user) {
    const stored = await vault.getJSON(keyFor(user));
    if (stored?.disabled) return { aiEnabled:false, geminiKey:'', geminiModel:defaultModel, source:'none' };
    if (stored?.apiKey) return { aiEnabled:true, geminiKey:stored.apiKey, geminiModel:stored.model, source:'app' };
    return { aiEnabled:Boolean(config.aiEnabled && config.geminiKey), geminiKey:config.aiEnabled ? config.geminiKey || '' : '', geminiModel:validModel(config.geminiModel) ? config.geminiModel : defaultModel, source:config.aiEnabled && config.geminiKey ? 'server' : 'none' };
  }
  const publicStatus = settings => ({ aiConfigured:Boolean(settings.aiEnabled && settings.geminiKey), model:settings.geminiModel, source:settings.source });
  async function status(user) { return publicStatus(await resolve(user)); }
  async function connect(user, body) {
    const name = keyFor(user);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const model = body.model || defaultModel;
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(apiKey)) throw fault('Google AI Studio에서 복사한 API 키 전체를 입력해 주세요.');
    if (!validModel(model)) throw fault('Gemini 모델 이름을 확인해 주세요.');
    const release = await vault.acquireLease(`aiSettings/${user.uid}`, 30000);
    try {
      let response;
      try {
        response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
          body:JSON.stringify({contents:[{role:'user',parts:[{text:'Reply with OK.'}]}], generationConfig:{maxOutputTokens:64,temperature:0,...(model.startsWith('gemini-2.5-flash') ? {thinkingConfig:{thinkingBudget:0}} : {})}}),
          signal:AbortSignal.timeout(15000),
        });
      } catch { throw fault('Gemini에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502); }
      if (!response.ok) throw fault(aiFailureMessage(response.status), response.status === 429 ? 429 : 400);
      const result = await response.json().catch(() => null);
      if (!result?.candidates?.some(candidate => candidate.content?.parts?.some(part => typeof part.text === 'string' && part.text.trim()))) throw fault('Gemini 응답을 확인하지 못했습니다. 모델을 확인한 뒤 다시 연결해 주세요.', 502);
      await vault.setJSON(name, { apiKey, model, connectedAt:new Date().toISOString() });
      return { aiConfigured:true, model, source:'app' };
    } finally { await release(); }
  }
  async function disconnect(user) {
    const name = keyFor(user), release = await vault.acquireLease(`aiSettings/${user.uid}`, 30000);
    try { await vault.setJSON(name, { disabled:true }); return { aiConfigured:false, model:defaultModel, source:'none' }; }
    finally { await release(); }
  }
  return { status, resolve, connect, disconnect };
}
