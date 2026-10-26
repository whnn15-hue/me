import {randomUUID} from 'node:crypto';
import {normalizeGeminiKey} from '../../shared/gemini-key.mjs';
import {readAiDiagnostic} from '../../shared/ai-diagnostic.mjs';
import {validGeminiModel,verifyGeminiConnection} from './gemini.mjs';

const fault=(message,status=400)=>Object.assign(new Error(message),{status});
const publicConnection=value=>({aiConfigured:true,model:value.model,modelSelection:value.modelSelection || 'manual',source:'app'});
const active=job=>job && ['queued','running'].includes(job.status);
const validId=id=>typeof id==='string' && /^[a-f0-9-]{36}$/.test(id);

// Job records contain IDs/status/models only. An unverified API key travels in
// the authenticated worker request, never in a queued job or status response.
// One per-owner record and the existing settings lease bound concurrency.
export function createAiConnectionJobs({vault,settingsKeyFor,fetcher}) {
  const jobKey=user=>`aiConnectionJob/${settingsKeyFor(user)}`;
  function safeJob(job,connection) {
    if (!job || !validId(job.id)) return null;
    if (connection?.verificationJobId===job.id && connection.apiKey) return {id:job.id,status:'succeeded',connection:publicConnection(connection)};
    if (active(job) && job.expiresAt<=Date.now()) return {id:job.id,status:'failed',error:'연결 검사가 제한 시간 안에 완료되지 않았습니다. 다시 연결해 주세요.'};
    return {id:job.id,status:job.status,...(active(job) ? {expiresAt:job.expiresAt} : {}),
      ...(job.error ? {error:job.error} : {}),...(readAiDiagnostic(job.diagnostic) ? {diagnostic:readAiDiagnostic(job.diagnostic)} : {}),
      ...(job.status==='succeeded' && job.connection ? {connection:publicConnection(job.connection)} : {})};
  }
  async function current(user,id) {
    const settingsKey=settingsKeyFor(user),job=await vault.getJSON(jobKey(user));
    if (id && !validId(id)) throw fault('연결 요청 번호가 올바르지 않습니다.');
    if (id && (!job || job.id!==id)) throw fault('다른 연결 요청이 시작되었습니다. 설정 화면에서 연결 상태를 확인해 주세요.',409);
    if (!job || job.ownerUid!==user.uid) return null;
    return safeJob(job,await vault.getJSON(settingsKey));
  }
  // Called under the shared settings lease when a newer connect/disconnect wins.
  async function invalidate(user) {
    const key=jobKey(user),job=await vault.getJSON(key);
    if (job?.id) await vault.setJSON(key,{...job,status:'failed',error:'새 설정으로 인해 이전 연결 요청을 취소했습니다.'});
  }
  async function start(user,body) {
    const settingsKey=settingsKeyFor(user),key=jobKey(user);
    const models=Array.isArray(body.models) ? [...new Set(body.models.map(model=>typeof model==='string' ? model.trim().replace(/^models\//,'') : model))] : [];
    const modelSelection=body.modelSelection==='manual' ? 'manual' : 'auto';
    if (!models.length || models.length>3 || models.some(model=>!validGeminiModel(model)) || modelSelection==='manual' && models.length!==1) throw fault('연결할 Gemini 모델을 확인해 주세요.');
    if (modelSelection==='auto' && models.some(model=>!/-flash(?:-|$)/.test(model) || /(?:image|audio|tts|live|embedding|robotics|computer-use|deep-research)/i.test(model))) throw fault('자동 연결은 문서 분석용 Flash 모델을 사용합니다.');
    const release=await vault.acquireLease(settingsKey,30000);
    try {
      const existing=await vault.getJSON(key);
      if (existing?.status==='running' && existing.expiresAt>Date.now()) throw fault('연결 검사가 진행 중입니다. 결과를 확인해 주세요.',409);
      const job={id:randomUUID(),ownerUid:user.uid,status:'queued',models,modelSelection,createdAt:Date.now(),expiresAt:Date.now()+180000};
      await vault.setJSON(key,job);return safeJob(job);
    } finally {await release();}
  }
  async function run(user,body) {
    const settingsKey=settingsKeyFor(user),key=jobKey(user);
    if (!validId(body.jobId)) throw fault('연결 요청 번호가 올바르지 않습니다.');
    const release=await vault.acquireLease(settingsKey,120000);
    try {
      let job=await vault.getJSON(key);
      if (!job || job.id!==body.jobId || job.ownerUid!==user.uid) throw fault('만료되었거나 다른 계정의 연결 요청입니다.',409);
      const previous=await vault.getJSON(settingsKey),prior=safeJob(job,previous);
      if (!active(prior)) return prior;
      job={...job,status:'running',expiresAt:Date.now()+110000};await vault.setJSON(key,job);
      try {
        const apiKey=normalizeGeminiKey(body.apiKey),signal=AbortSignal.timeout(90000);
        let verified;
        for (let index=0;index<job.models.length;index++) {
          try { verified=await verifyGeminiConnection({apiKey,requestedModel:job.models[index],fetcher,signal});break; }
          catch(error) {
            if (job.modelSelection==='auto' && index+1<job.models.length && ['model','response'].includes(error.diagnostic?.kind) && !signal.aborted) continue;
            throw error;
          }
        }
        if (!verified) throw fault('Gemini 응답을 확인하지 못했습니다.',502);
        const connected={apiKey,model:verified.model,modelSelection:job.modelSelection,connectedAt:new Date().toISOString(),verificationJobId:job.id};
        await vault.setJSON(settingsKey,connected);
        const connection=publicConnection(connected);
        await vault.setJSON(key,{...job,status:'succeeded',connection});
        return {id:job.id,status:'succeeded',connection};
      } catch(error) {
        const diagnostic=readAiDiagnostic(error.diagnostic);
        // Raw provider/vault errors can contain credentials. Only the known
        // diagnostic messages generated by our verifier are persisted.
        const failed={...job,status:'failed',error:diagnostic ? error.message : '연결 검사를 완료하지 못했습니다. 입력한 키와 배포 상태를 확인해 주세요.',...(diagnostic ? {diagnostic} : {})};
        await vault.setJSON(key,failed);return safeJob(failed,await vault.getJSON(settingsKey));
      }
    } finally {await release();}
  }
  return {current,start,run,invalidate};
}
