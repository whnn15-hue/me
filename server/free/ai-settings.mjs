import { discoverGeminiModels, validGeminiModel, verifyGeminiConnection } from './gemini.mjs';
import { normalizeGeminiKey } from '../../shared/gemini-key.mjs';

const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const defaultModel = 'auto';

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
    if (stored?.apiKey) return { aiEnabled:true, geminiKey:stored.apiKey, geminiModel:stored.model, source:'app', modelSelection:stored.modelSelection || 'manual' };
    return { aiEnabled:Boolean(config.aiEnabled && config.geminiKey), geminiKey:config.aiEnabled ? config.geminiKey || '' : '', geminiModel:validGeminiModel(config.geminiModel) ? config.geminiModel : defaultModel, source:config.aiEnabled && config.geminiKey ? 'server' : 'none' };
  }
  const publicStatus = settings => ({ aiConfigured:Boolean(settings.aiEnabled && settings.geminiKey), model:settings.geminiModel, source:settings.source, modelSelection:settings.modelSelection || 'auto' });
  async function status(user) { return publicStatus(await resolve(user)); }
  async function models(user, body) {
    keyFor(user);
    let apiKey;
    try { apiKey = normalizeGeminiKey(body.apiKey); }
    catch(error) { throw fault(error.message); }
    return {models:await discoverGeminiModels({apiKey,fetcher})};
  }
  async function connect(user, body) {
    const name = keyFor(user);
    let apiKey;
    try { apiKey = normalizeGeminiKey(body.apiKey); }
    catch (error) { throw fault(error.message); }
    const release = await vault.acquireLease(`aiSettings/${user.uid}`, 30000);
    try {
      const verified = await verifyGeminiConnection({apiKey,requestedModel:body.model,fetcher});
      if (body.modelSelection === 'auto') verified.modelSelection = 'auto';
      await vault.setJSON(name, { apiKey, ...verified, connectedAt:new Date().toISOString() });
      return { aiConfigured:true, ...verified, source:'app' };
    } finally { await release(); }
  }
  async function disconnect(user) {
    const name = keyFor(user), release = await vault.acquireLease(`aiSettings/${user.uid}`, 30000);
    try { await vault.setJSON(name, { disabled:true }); return { aiConfigured:false, model:defaultModel, source:'none' }; }
    finally { await release(); }
  }
  return { status, models, resolve, connect, disconnect };
}
