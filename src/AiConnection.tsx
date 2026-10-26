import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, KeyRound, LoaderCircle, Sparkles } from "lucide-react";
import { api } from "./api";
import { normalizeGeminiKey } from "../shared/gemini-key.mjs";

interface Connection { aiConfigured:boolean; model:string; source:string }
export default function AiConnection({ onRefresh, compact=false }: { onRefresh:()=>Promise<void>; compact?:boolean }) {
  const [connection,setConnection] = useState<Connection | null>(null);
  const [key,setKey] = useState("");
  const [manualModel,setManualModel] = useState(false), [model,setModel] = useState("");
  const [pending,setPending] = useState(false), [loading,setLoading] = useState(true);
  const [error,setError] = useState(""), [notice,setNotice] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    api<Connection>("/ai/settings").then(result => { if(active) setConnection(result); }).catch(() => { if(active) setError("AI 연결 상태를 읽지 못했습니다. 잠시 후 설정 화면을 다시 열어 주세요."); }).finally(() => {if(active) setLoading(false);});
    return () => {active=false;};
  }, []);
  async function update(disconnect=false) {
    if(lock.current) return;
    lock.current=true; setPending(true); setError(""); setNotice("");
    try {
      const result = await api<Connection>("/ai/settings", {method:disconnect ? "DELETE" : "PUT", ...(disconnect ? {} : {body:JSON.stringify({apiKey:normalizeGeminiKey(key),model:manualModel ? model.trim() : "auto"})})});
      setConnection(result); setKey("");
      setNotice(disconnect ? "AI 연결을 해제했습니다. 원본과 경력은 유지됩니다." : `Gemini 연결을 확인했습니다 (${result.model}). 이제 공문 보관함의 분석 버튼으로 다시 분석할 수 있습니다.`);
      await onRefresh();
    } catch(cause) {setError(cause instanceof Error ? cause.message : "연결하지 못했습니다.");}
    finally {lock.current=false; setPending(false);}
  }
  return <section className={`ai-connection ${compact ? "compact" : "panel settings-card"}`} aria-label="Gemini AI 연결" onKeyDown={event => {if(event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();}}>
    <header><span className="ai-connection-icon"><Sparkles size={21}/></span><div><h2>공문 AI 분석</h2><p>기관, 역할, 날짜와 태그를 초안으로 정리</p></div><span className={`connection-badge ${connection?.aiConfigured ? "connected" : ""}`}>{loading ? "확인 중" : connection?.aiConfigured ? "Gemini 연결됨" : "연결 필요"}</span></header>
    {loading ? <p className="ai-connection-status"><LoaderCircle size={16} className="spin"/>연결 확인 중</p> : <>
      {connection?.aiConfigured && <p className="ai-connection-status"><Check size={16}/>{connection.model}</p>}
      <p className="ai-connection-description">Google AI Studio에서 키를 발급받아 아래에 한 번 등록하세요. 분석할 문서 내용은 Google Gemini로 전송됩니다. 무료 한도와 과금 여부는 해당 Google 프로젝트 설정을 따릅니다.</p>
      <a className="ai-key-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"><KeyRound size={15}/>Google AI Studio에서 키 발급<ExternalLink size={14}/></a>
      <fieldset disabled={pending}>
        <label className="field"><span>{connection?.aiConfigured ? "새 Gemini API 키" : "Gemini API 키"}</span><input type="password" value={key} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="여기에 API 키 붙여넣기" onChange={event=>setKey(event.target.value)}/></label>
        <details className="ai-model-options"><summary>모델 설정, {manualModel ? "직접 지정" : "자동 선택"}</summary><label className="ai-model-switch"><input type="checkbox" checked={manualModel} onChange={event=>setManualModel(event.target.checked)}/>모델 직접 지정</label>{manualModel ? <label className="field"><span>Gemini 모델</span><input value={model} maxLength={140} placeholder="Google AI Studio의 모델 이름" onChange={event=>setModel(event.target.value)}/></label> : <p>사용 가능한 Flash 모델을 조회하고, 문서 분석 응답이 확인된 모델로 연결합니다.</p>}</details>
        <div className="ai-connection-actions"><button type="button" className="button primary" disabled={!key.trim() || (manualModel && !model.trim())} onClick={()=>void update()}>{pending ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>}연결 확인 후 저장</button>{connection?.aiConfigured && <button type="button" className="button secondary" onClick={()=>void update(true)}>연결 해제</button>}</div>
      </fieldset>
      <small>키는 서버에 암호화해서 보관하며 기록 백업에 포함하지 않습니다.</small>
    </>}
    {error && <p className="alert error" role="alert">{error}</p>}
    {notice && <p className="ai-connection-success" role="status">{notice}</p>}
  </section>;
}
