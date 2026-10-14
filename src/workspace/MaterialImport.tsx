import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, CloudUpload, FileText, FolderInput, LoaderCircle, Upload, X } from "lucide-react";
import { materialFileFromImportCode } from "../backup-code";
import { displayLabel } from "./WorkspaceUI";
import type { PreparedMaterialImport, MaterialImportProgress, MaterialImportResult } from "../free/material-import";
import "./MaterialImport.css";

export default function MaterialImport({ driveConnected, disabled = false, onBusyChange, onRefresh, onToast }: {
  driveConnected: boolean; disabled?: boolean; onBusyChange: (busy: boolean) => void;
  onRefresh: () => Promise<void>; onToast: (message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [prepared, setPrepared] = useState<PreparedMaterialImport | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "reading" | "saving">("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<MaterialImportProgress | null>(null);
  const [result, setResult] = useState<MaterialImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => () => {
    controller.current?.abort();
    if (running.current) busyCallback.current(false);
  }, []);
  const locked = Boolean(disabled || busy);

  async function prepare(file?: File) {
    if (running.current || disabled) return;
    running.current = true; onBusyChange(true); setBusy("reading"); setError(""); setResult(null);
    const operation = new AbortController(); controller.current = operation;
    try {
      const input = file ?? await materialFileFromImportCode(code);
      const { readMaterialImportFile } = await import("../free/material-import");
      const parsed = await readMaterialImportFile(input, { signal: operation.signal });
      setPrepared(parsed); setSelected(parsed.materials.map(material => material.item.id)); setCode("");
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "학급 자료를 읽지 못했습니다.");
    } finally { running.current = false; controller.current = null; setBusy(""); onBusyChange(false); }
  }
  async function save() {
    if (!prepared || running.current || disabled || !driveConnected || !selected.length) return;
    running.current = true; onBusyChange(true); setBusy("saving"); setError(""); setProgress(null);
    const operation = new AbortController(); controller.current = operation;
    try {
      const { applyMaterialImport } = await import("../free/material-import");
      const saved = await applyMaterialImport(prepared, { approvedMaterialIds: selected, signal: operation.signal, onProgress: setProgress });
      setResult(saved); setPrepared(null); setSelected([]);
      onToast(`학급 자료 ${saved.added}개를 추가했습니다. 이미 있는 자료 ${saved.duplicates}개는 유지했습니다.`);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "AbortError" ? "가져오기를 중단했습니다. 같은 묶음으로 다시 시도할 수 있어요." : cause instanceof Error ? cause.message : "학급 자료를 저장하지 못했습니다.");
      await onRefresh().catch(() => {});
    } finally { running.current = false; controller.current = null; setBusy(""); onBusyChange(false); }
  }

  return <details className="material-import panel">
    <summary><FolderInput size={20} /><span><strong>정리한 학급 자료 가져오기</strong><small>파일을 드라이브에 보관하고 이 서가에 추가해요</small></span><ChevronDown size={17} /></summary>
    <div className="material-import-body">
      {!prepared && <>
        <label className="field"><span>학급 자료 코드</span><textarea aria-label="학급 자료 코드" rows={2} value={code} disabled={locked} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="전달받은 IMMT1: 코드를 붙여넣으세요" onChange={event => { setCode(event.target.value); setError(""); }} /></label>
        <div className="material-import-actions"><button className="button primary" disabled={locked || !code.trim()} onClick={() => void prepare()}>{busy === "reading" ? <LoaderCircle className="spin" size={16} /> : <FolderInput size={16} />}자료 목록 확인</button><button className="button secondary" disabled={locked} onClick={() => fileInput.current?.click()}><Upload size={16} />자료 묶음 ZIP 선택</button><input ref={fileInput} type="file" className="visually-hidden" accept=".zip" aria-label="가져올 학급 자료 ZIP" disabled={locked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void prepare(file); }} /></div>
      </>}
      {prepared && <>
        <div className="material-import-review-heading"><h3>추가할 학급 자료 {selected.length}개</h3><button className="text-button" disabled={locked} onClick={() => { setPrepared(null); setSelected([]); setError(""); }}><X size={15} />취소</button></div>
        <fieldset className="material-import-items" disabled={locked}><legend className="visually-hidden">추가할 학급 자료 선택</legend>{prepared.materials.map(({ item, documentId }) => <label className="material-import-item" key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
          <span><strong><FileText size={15} />{displayLabel(item.title)}</strong><small>{item.format}, {displayLabel(prepared.documents.find(document => document.id === documentId)?.name || "")}</small><p>{displayLabel(item.summary)}</p><span className="tags">{item.tags.map(tag => <span key={tag}>#{displayLabel(tag)}</span>)}</span></span>
        </label>)}</fieldset>
        <p className="material-import-note">원본은 연결한 드라이브에 저장하고, 여기에는 파일 링크와 활용 메모를 추가합니다. 기존 수업과 강의 자료는 유지합니다.</p>
        <div className="material-import-actions"><button className="button primary" disabled={locked || !driveConnected || !selected.length} onClick={() => void save()}>{busy === "saving" ? <LoaderCircle className="spin" size={16} /> : <CloudUpload size={16} />}{busy === "saving" ? "학급 자료 추가 중" : "드라이브에 보관하고 추가"}</button>{busy === "saving" && <button className="text-button" disabled={progress?.phase === "saving" || progress?.phase === "done"} onClick={() => controller.current?.abort()}>중단하기</button>}</div>
      </>}
      {busy === "saving" && progress && <div className="material-import-progress" role="status"><span>{progress.phase === "saving" ? "자료 목록 저장 중" : progress.phase === "validating" ? "원본과 기존 자료 확인 중" : "드라이브에 원본 보관 중"} {progress.completed} / {progress.total}</span><progress aria-label="학급 자료 가져오기 진행률" max={Math.max(1, progress.total)} value={progress.completed} /></div>}
      {result && <p className="material-import-result" role="status"><Check size={18} />학급 자료 {result.added}개 추가, 기존 자료 {result.duplicates}개 유지</p>}
      {!driveConnected && <p className="material-import-note">백업 및 설정에서 구글 드라이브를 연결하면 원본을 저장할 수 있어요. 자료 목록은 먼저 확인할 수 있습니다.</p>}
      {error && <div className="alert error" role="alert">{displayLabel(error)}</div>}
    </div>
  </details>;
}
