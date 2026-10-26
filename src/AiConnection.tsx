import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, KeyRound, LoaderCircle, Sparkles } from "lucide-react";
import { api } from "./api";
import { normalizeGeminiKey } from "../shared/gemini-key.mjs";
import {readAiDiagnostic, type AiDiagnostic} from "../shared/ai-diagnostic.mjs";

interface Connection { aiConfigured:boolean; model:string; source:string; job?:ConnectionJob }
interface ConnectionJob { id:string; status:"queued"|"running"|"succeeded"|"failed"; connection?:Connection; error?:string; diagnostic?:AiDiagnostic }
export default function AiConnection({ onRefresh, compact=false }: { onRefresh:()=>Promise<void>; compact?:boolean }) {
  const [connection,setConnection] = useState<Connection | null>(null);
  const [key,setKey] = useState("");
  const [manualModel,setManualModel] = useState(false), [model,setModel] = useState("");
  const [pending,setPending] = useState(false), [loading,setLoading] = useState(true);
  const [error,setError] = useState(""), [notice,setNotice] = useState("");
  const [phase,setPhase] = useState(""), [diagnostic,setDiagnostic] = useState<AiDiagnostic|null>(null);
  const lock = useRef(false);
  const epoch = useRef(0);
  async function waitForJob(id:string,version:number):Promise<Connection|null> {
    const started=Date.now();
    while(epoch.current===version && Date.now()-started<130000) {
      const job=await api<ConnectionJob>(`/ai/connect/status?jobId=${encodeURIComponent(id)}`);
      if(epoch.current!==version) return null;
      if(job?.status==="succeeded" && job.connection) return job.connection;
      if(job?.status==="failed") throw Object.assign(new Error(job.error || "연결 검사를 완료하지 못했습니다."),{diagnostic:readAiDiagnostic(job.diagnostic)});
      if(!job || !["queued","running"].includes(job.status)) throw new Error("연결 검사 상태를 확인하지 못했습니다.");
      if(job.status==="queued" && Date.now()-started>20000) throw new Error("연결 검사 작업이 시작되지 않았습니다. 배포 상태를 확인한 뒤 다시 연결해 주세요.");
      setPhase(job.status==="queued" ? "연결 검사 시작 대기 중" : "Google 응답 확인 중, 최대 90초 정도 걸릴 수 있습니다.");
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    if(epoch.current!==version) return null;
    throw new Error("연결 검사가 아직 완료되지 않았습니다. 잠시 후 설정 화면에서 결과를 확인해 주세요.");
  }
  useEffect(() => {
    const version=++epoch.current;
    api<Connection>("/ai/settings").then(async result => {
      if(epoch.current!==version) return;
      setConnection(result);setLoading(false);
      if(result.job?.status==="failed") {
        setError(result.job.error || "이전 연결 검사를 완료하지 못했습니다.");
        setDiagnostic(readAiDiagnostic(result.job.diagnostic));
      }
      if(result.job && ["queued","running"].includes(result.job.status)) {
        lock.current=true;setPending(true);setPhase("이전 연결 검사 결과 확인 중");
        try {const connected=await waitForJob(result.job.id,version);if(connected){setConnection(connected);setNotice("Gemini 연결을 확인했습니다.");await onRefresh();}}
        catch(cause){if(epoch.current===version){setError(cause instanceof Error ? cause.message : "연결 검사를 확인하지 못했습니다.");setDiagnostic(readAiDiagnostic(cause && typeof cause==="object" && "diagnostic" in cause ? cause.diagnostic : null));}}
        finally {if(epoch.current===version){lock.current=false;setPending(false);setPhase("");}}
      }
    }).catch(() => {if(epoch.current===version) setError("AI 연결 상태를 읽지 못했습니다. 잠시 후 설정 화면을 다시 열어 주세요.");}).finally(()=>{if(epoch.current===version)setLoading(false);});
    return () => {epoch.current++;};
  }, []);
  async function update(disconnect=false) {
    if(lock.current) return;
    const version=epoch.current;
    lock.current=true; setPending(true); setError(""); setNotice(""); setDiagnostic(null);
    try {
      let result:Connection|undefined;
      if (disconnect) {
        setPhase("연결 해제 중");
        result = await api<Connection>("/ai/settings",{method:"DELETE"});
      } else {
        const apiKey = normalizeGeminiKey(key);
        setPhase(manualModel ? "분석 응답 확인 중" : "1/2 사용 가능한 모델 확인 중");
        const models = manualModel ? [model.trim()] : (await api<{models:string[]}>("/ai/models",{method:"POST",body:JSON.stringify({apiKey})})).models;
        if (!Array.isArray(models) || !models.length || models.length > 3 || models.some(value=>typeof value !== "string")) throw new Error("사용 가능한 모델 목록을 확인하지 못했습니다.");
        setPhase("2/2 연결 검사 시작 중");
        const job=await api<ConnectionJob>("/ai/connect/start",{method:"POST",body:JSON.stringify({models,modelSelection:manualModel ? "manual" : "auto"})});
        await api("/ai/connect/run",{method:"POST",body:JSON.stringify({jobId:job.id,apiKey})});
        const connected=await waitForJob(job.id,version);
        if(!connected) return;
        result=connected;
      }
      if (!result) throw new Error("Gemini 연결 결과를 확인하지 못했습니다.");
      setConnection(result); setKey("");
      setNotice(disconnect ? "AI 연결을 해제했습니다. 원본과 경력은 유지됩니다." : `Gemini 연결을 확인했습니다 (${result.model}). 이제 공문 보관함의 분석 버튼으로 다시 분석할 수 있습니다.`);
      await onRefresh();
    } catch(cause) {if(epoch.current===version){setError(cause instanceof Error ? cause.message : "연결하지 못했습니다.");setDiagnostic(readAiDiagnostic(cause && typeof cause === "object" && "diagnostic" in cause ? cause.diagnostic : null));}}
    finally {if(epoch.current===version){lock.current=false; setPending(false);setPhase("");}}
  }
  return <section className={`ai-connection ${compact ? "compact" : "panel settings-card"}`} aria-label="Gemini AI 연결" onKeyDown={event => {if(event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();}}>
    <header><span className="ai-connection-icon"><Sparkles size={21}/></span><div><h2>공문 AI 분석</h2><p>기관, 역할, 날짜와 태그를 초안으로 정리</p></div><span className={`connection-badge ${connection?.aiConfigured ? "connected" : ""}`}>{loading ? "확인 중" : connection?.aiConfigured ? "Gemini 연결됨" : "연결 필요"}</span></header>
    {loading ? <p className="ai-connection-status"><LoaderCircle size={16} className="spin"/>연결 확인 중</p> : <>
      {connection?.aiConfigured && <p className="ai-connection-status"><Check size={16}/>{connection.model}</p>}
      <p className="ai-connection-description">Google AI Studio에서 키를 발급받아 아래에 한 번 등록하세요. 분석할 문서 내용은 Google Gemini로 전송됩니다. 무료 한도와 과금 여부는 해당 Google 프로젝트 설정을 따릅니다.</p>
      <a className="ai-key-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"><KeyRound size={15}/>Google AI Studio에서 키 발급<ExternalLink size={14}/></a>
      <fieldset disabled={pending}>
        <label className="field"><span>{connection?.aiConfigured ? "새 Gemini API 키" : "Gemini API 키"}</span><input type="password" value={key} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="여기에 API 키 붙여넣기" onChange={event=>{setKey(event.target.value);setError("");setDiagnostic(null);}}/></label>
        <details className="ai-model-options"><summary>모델 설정, {manualModel ? "직접 지정" : "자동 선택"}</summary><label className="ai-model-switch"><input type="checkbox" checked={manualModel} onChange={event=>{setManualModel(event.target.checked);setError("");setDiagnostic(null);}}/>모델 직접 지정</label>{manualModel ? <label className="field"><span>Gemini 모델</span><input value={model} maxLength={140} placeholder="Google AI Studio의 모델 이름" onChange={event=>{setModel(event.target.value);setError("");setDiagnostic(null);}}/></label> : <p>사용 가능한 Flash 모델을 조회하고, 문서 분석 응답이 확인된 모델로 연결합니다.</p>}</details>
        <div className="ai-connection-actions"><button type="button" className="button primary" disabled={!key.trim() || (manualModel && !model.trim())} onClick={()=>void update()}>{pending ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>}연결 확인 후 저장</button>{connection?.aiConfigured && <button type="button" className="button secondary" onClick={()=>void update(true)}>연결 해제</button>}</div>
      </fieldset>
      <small>키는 서버에 암호화해서 보관하며 기록 백업에 포함하지 않습니다.</small>
    </>}
    {pending && <p className="ai-connection-status" role="status"><LoaderCircle size={16} className="spin"/>{phase}</p>}
    {error && <p className="alert error" role="alert">{error}</p>}
    {diagnostic && <div className="ai-diagnostic"><code>{diagnostic.code}</code><button type="button" className="text-button" onClick={async()=>{try {await navigator.clipboard.writeText(JSON.stringify(diagnostic));setNotice("오류 정보를 복사했습니다. 키나 문서 내용은 포함되지 않습니다.");}catch {setNotice("위 오류 코드를 복사해서 알려주세요. 키는 보내지 마세요.");}}}>오류 정보 복사</button></div>}
    {notice && <p className="ai-connection-success" role="status">{notice}</p>}
  </section>;
}
