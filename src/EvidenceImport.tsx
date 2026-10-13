import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  CloudUpload,
  FileCheck2,
  FileText,
  FolderInput,
  Link2,
  LoaderCircle,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { evidenceFileFromImportCode } from "./backup-code";
import type { Career } from "./types";
import type {
  EvidenceImportProgress,
  PreparedEvidenceImport,
} from "./free/evidence-import";

type ImportResult = Awaited<ReturnType<typeof import("./free/evidence-import")["applyEvidenceImport"]>>;

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function reviewNote(text?: string) {
  if (!text) return "";
  const marker = text.indexOf("[원문 텍스트]");
  // Only the prepared review note belongs in this compact preview. Document
  // bodies may include personal information about other people.
  return marker >= 0 ? text.slice(0, marker).trim().slice(0, 4000) : "";
}

function changedCareerFields(archived: Career | undefined, current: Career) {
  if (!archived) return [];
  const changes: string[] = [];
  if (archived.title !== current.title) changes.push("제목");
  if (archived.organization !== current.organization) changes.push("기관");
  if (archived.role !== current.role) changes.push("역할");
  if (archived.category !== current.category) changes.push("분류");
  if (archived.startDate !== current.startDate || archived.endDate !== current.endDate || archived.datePrecision !== current.datePrecision) changes.push("기간");
  if (archived.description !== current.description) changes.push("설명");
  if (JSON.stringify(archived.tags) !== JSON.stringify(current.tags)) changes.push("태그");
  return changes;
}

function careerContext(career: Career) {
  return [
    [career.startDate, career.endDate].filter(Boolean).join(" ~ "),
    career.organization,
    career.role,
  ].filter(Boolean).join(", ");
}

export default function EvidenceImport({
  driveConnected,
  disabled = false,
  onBusyChange,
  onRefresh,
  onToast,
  onBackup,
}: {
  driveConnected: boolean;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
  onToast: (message: string) => void;
  onBackup: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [prepared, setPrepared] = useState<PreparedEvidenceImport | null>(null);
  const [reviewCareers, setReviewCareers] = useState<Career[]>([]);
  const [approvedLinks, setApprovedLinks] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState<"input" | "preparing" | "review" | "importing" | "complete">("input");
  const [progress, setProgress] = useState<EvidenceImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [canceled, setCanceled] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const callbacks = useRef({ onBusyChange });
  callbacks.current = { onBusyChange };
  useEffect(() => () => {
    controllerRef.current?.abort();
    if (operationRef.current) callbacks.current.onBusyChange(false);
  }, []);

  const working = step === "preparing" || step === "importing";
  const locked = disabled || working;
  const archivedCareerById = useMemo(
    () => new Map(prepared?.careers.map(career => [career.id, career]) ?? []),
    [prepared],
  );
  const careerById = useMemo(
    () => new Map(reviewCareers.map(career => [career.id, career])),
    [reviewCareers],
  );
  const linkedCareerCount = new Set(Object.values(approvedLinks).flat()).size;
  const linkedDocumentCount = Object.values(approvedLinks).filter(ids => ids.length > 0).length;
  const unlinkedCount = (prepared?.documents.length ?? 0) - linkedDocumentCount;
  const totalBytes = prepared?.documents.reduce((total, document) => total + document.size, 0) ?? 0;
  const percent = progress?.total ? Math.min(100, Math.round(progress.completed / progress.total * 100)) : 0;
  const progressLabel = progress?.phase === "saving"
    ? "경력과 증빙 연결을 저장하고 있어요"
    : progress?.phase === "validating"
      ? "현재 기록과 중복 파일을 확인하고 있어요"
      : progress?.phase === "done"
        ? "증빙 정리를 마쳤어요"
        : "공문 원본을 구글 드라이브에 보관하고 있어요";

  async function prepare(file?: File) {
    if (operationRef.current || disabled) return;
    operationRef.current = true;
    onBusyChange(true);
    setStep("preparing");
    setError("");
    setCanceled(false);
    setResult(null);
    try {
      const archive = file ?? await evidenceFileFromImportCode(code);
      const { readEvidenceImportFile, readEvidenceImportReviewCareers } = await import("./free/evidence-import");
      const content = await readEvidenceImportFile(archive);
      const latestCareers = await readEvidenceImportReviewCareers();
      const liveIds = new Set(latestCareers.map(career => career.id));
      const selections = Object.fromEntries(content.documents.map(document => [document.id, document.recordIds.filter(id => liveIds.has(id))]));
      setPrepared(content);
      setReviewCareers(latestCareers);
      setApprovedLinks(selections);
      setCode("");
      setStep("review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "증빙 묶음을 확인하지 못했습니다. 코드나 파일을 다시 확인해 주세요.");
      setStep("input");
    } finally {
      operationRef.current = false;
      onBusyChange(false);
    }
  }

  async function confirmImport() {
    if (!prepared || operationRef.current || disabled || !driveConnected) return;
    operationRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    onBusyChange(true);
    setStep("importing");
    setError("");
    setCanceled(false);
    setCanceling(false);
    setProgress({ phase: "validating", completed: 0, total: prepared.documents.length });
    try {
      const { applyEvidenceImport } = await import("./free/evidence-import");
      const saved = await applyEvidenceImport(prepared, {
        approvedLinks,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setResult(saved);
      setPrepared(null);
      setReviewCareers([]);
      setApprovedLinks({});
      setStep("complete");
      onToast(`증빙 ${saved.added}개를 추가하고 경력 연결 ${saved.linked}개를 저장했습니다.`);
      await onRefresh();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") setCanceled(true);
      else setError(cause instanceof Error ? cause.message : "증빙을 추가하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.");
      setStep(current => current === "complete" ? current : "review");
      // A network interruption can occur after a committed write. Refresh the
      // visible archive so retrying never relies on an outdated client count.
      await onRefresh().catch(() => {});
    } finally {
      operationRef.current = false;
      controllerRef.current = null;
      setCanceling(false);
      onBusyChange(false);
    }
  }

  function toggleLink(documentId: string, careerId: string, checked: boolean) {
    setApprovedLinks(current => ({
      ...current,
      [documentId]: checked
        ? [...new Set([...(current[documentId] ?? []), careerId])]
        : (current[documentId] ?? []).filter(id => id !== careerId),
    }));
  }

  function reset() {
    if (operationRef.current) return;
    setPrepared(null);
    setReviewCareers([]);
    setApprovedLinks({});
    setCode("");
    setResult(null);
    setError("");
    setCanceled(false);
    setProgress(null);
    setStep("input");
  }

  return (
    <section className="panel settings-card evidence-import" aria-labelledby="evidence-import-heading">
      <div className="evidence-import-heading">
        <span className="evidence-import-symbol"><FolderInput size={24} /></span>
        <div>
          <span className="evidence-eyebrow">흩어져 있던 공문을, 내 경력 곁으로</span>
          <h2 id="evidence-import-heading">정리한 증빙 가져오기</h2>
          <p>원본을 드라이브에 보관하고 알맞은 경력에 연결하세요.</p>
        </div>
        <span className="evidence-step-label">{step === "complete" ? "정리 완료" : prepared ? "02, 연결 확인" : "01, 묶음 불러오기"}</span>
      </div>

      {step === "input" || step === "preparing" ? (
        <div className="evidence-import-input">
          <label className="field evidence-code-field">
            <span>증빙 가져오기 코드</span>
            <textarea
              aria-label="증빙 가져오기 코드"
              rows={2}
              value={code}
              placeholder="전달받은 증빙 코드를 붙여넣으세요"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={locked}
              onChange={event => { setCode(event.target.value); setError(""); }}
            />
          </label>
          <div className="evidence-input-actions">
            <button className="button primary" disabled={locked || !code.trim()} onClick={() => void prepare()}>
              {step === "preparing" ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
              {step === "preparing" ? "증빙 확인 중" : "증빙 목록 확인"}
            </button>
            <span className="evidence-or">또는</span>
            <button className="button secondary" disabled={locked} onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> 증빙 묶음 ZIP 선택
            </button>
            <input
              ref={fileRef}
              className="visually-hidden"
              type="file"
              accept=".zip"
              aria-label="가져올 증빙 묶음 ZIP"
              disabled={locked}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void prepare(file);
              }}
            />
          </div>
          <p className="evidence-input-hint"><ShieldCheck size={14} /> 목록과 연결할 경력을 확인한 뒤 저장합니다.</p>
        </div>
      ) : null}

      {prepared && (
        <>
          <div className="evidence-import-summary" aria-label="증빙 가져오기 요약">
            <div><span>가져올 원본</span><strong>{prepared.documents.length}<small>개</small></strong><em>{sizeLabel(totalBytes)}</em></div>
            <div><span>연결할 경력</span><strong>{linkedCareerCount}<small>건</small></strong><em>증빙 {linkedDocumentCount}개 연결</em></div>
            <div><span>우선 보관</span><strong>{unlinkedCount}<small>개</small></strong><em>경력 연결은 나중에</em></div>
          </div>
          <div className="evidence-review-intro">
            <div><h3>경력 연결을 확인해 주세요</h3><p>현재 경력 목록을 불러왔어요. 연결할 경력에 체크하세요. 체크를 해제해도 원본은 보관됩니다.</p></div>
            <button type="button" className="text-button" disabled={locked} onClick={reset}><X size={14} /> 취소</button>
          </div>
          <div className="evidence-review-list" aria-label="가져올 증빙과 경력 연결">
            {prepared.documents.map((document, index) => {
              const proposedCareers = document.recordIds.map(id => ({ id, career: careerById.get(id), archived: archivedCareerById.get(id) }));
              const selected = approvedLinks[document.id] ?? [];
              const note = reviewNote(document.text);
              return (
                <article className="evidence-review-item" key={document.id}>
                  <div className="evidence-file-heading">
                    <span className="evidence-file-index">{String(index + 1).padStart(2, "0")}</span>
                    <FileText size={18} className="evidence-file-icon" />
                    <div className="evidence-file-name"><h4>{document.name}</h4><p>{sizeLabel(document.size)}{document.analysisStatus && <><span aria-hidden="true">, </span>{document.analysisStatus}</>}</p></div>
                    <span className={`evidence-link-count ${selected.length ? "has-links" : ""}`}>{selected.length ? <><Link2 size={12} /> {selected.length}</> : "우선 보관"}</span>
                  </div>
                  {proposedCareers.length > 0 ? (
                    <fieldset className="evidence-career-options" disabled={locked}>
                      <legend className="visually-hidden">{document.name}에 연결할 경력</legend>
                      {proposedCareers.map(({ id, career, archived }) => {
                        if (!career) return (
                          <label className="evidence-career-choice evidence-career-missing" key={id}>
                            <input type="checkbox" disabled checked={false} readOnly />
                            <span><strong>{archived?.title || "묶음에 포함된 경력"}</strong><small>현재 경력 목록에서 찾을 수 없어 연결 대상에서 제외했습니다.</small></span>
                          </label>
                        );
                        const changes = changedCareerFields(archived, career);
                        return (
                        <label className="evidence-career-choice" key={id}>
                          <input
                            type="checkbox"
                            checked={selected.includes(career.id)}
                            onChange={event => toggleLink(document.id, career.id, event.target.checked)}
                          />
                          <span><strong>{career.title}</strong><small>{careerContext(career)}</small>
                            {changes.length > 0 && <small className="evidence-career-change">현재 기록에 변경된 항목: {changes.join(", ")}
                              <span>묶음 당시: {archived?.title}{archived && careerContext(archived) ? ` (${careerContext(archived)})` : ""}</span>
                            </small>}
                          </span>
                        </label>
                        );
                      })}
                    </fieldset>
                  ) : <p className="evidence-unlinked-note">연결할 경력을 찾지 못했어요. 공문 보관함에 저장한 뒤 연결할 수 있어요.</p>}
                  {note && <details className="evidence-review-note"><summary><ChevronDown size={13} /> 연결 근거와 확인 사항</summary><p>{note}</p></details>}
                </article>
              );
            })}
          </div>
          <div className="evidence-preserve-note"><CheckCheck size={17} /><p>현재 경력 내용은 유지하고 증빙 연결을 추가합니다. 이미 보관한 동일 파일은 재사용합니다.</p></div>

          {step === "importing" && (
            <div className="evidence-import-progress" role="status" aria-live="polite">
              <div><LoaderCircle className="spin" size={16} /><strong>{canceling ? "중단 요청을 처리하고 있어요" : progressLabel}</strong><span>{progress?.completed ?? 0} / {progress?.total ?? prepared.documents.length}</span></div>
              <progress aria-label="증빙 가져오기 진행률" max={100} value={percent} />
              {progress?.fileName && <p>{progress.fileName}</p>}
            </div>
          )}

          <div className="evidence-confirm-actions">
            <button className="button primary" disabled={locked || !driveConnected || prepared.documents.length === 0} onClick={() => void confirmImport()}>
              {step === "importing" ? <LoaderCircle className="spin" size={17} /> : <CloudUpload size={17} />}
              {step === "importing" ? "증빙 추가 중" : "증빙 추가하고 연결"}
            </button>
            {step === "importing" && <button className="text-button" disabled={canceling || progress?.phase === "saving" || progress?.phase === "done"} onClick={() => { setCanceling(true); controllerRef.current?.abort(); }}>중단하기</button>}
            {step !== "importing" && <span>원본 {prepared.documents.length}개, 경력 {linkedCareerCount}건</span>}
          </div>
        </>
      )}

      {step === "complete" && result && (
        <div className="evidence-import-complete" role="status">
          <span className="evidence-complete-mark"><Check size={22} /></span>
          <div><h3>증빙이 내 경력에 자리 잡았어요</h3><p>원본 {result.added}개 추가, 동일 파일 {result.duplicates}개 재사용, 경력 연결 {result.linked}개 저장</p>{result.unmatched > 0 && <p>경력과 연결하지 않은 {result.unmatched}개는 공문 보관함에서 확인할 수 있어요.</p>}</div>
          <div className="evidence-complete-actions">
            <button className="button secondary" disabled={disabled} onClick={() => void onBackup()}><FileCheck2 size={15} /> 지금 백업하기</button>
            <button className="text-button" disabled={disabled} onClick={reset}>다른 증빙 가져오기 <ArrowRight size={14} /></button>
          </div>
        </div>
      )}
      {!driveConnected && <div className="evidence-import-notice"><CloudUpload size={16} /><span>아래에서 구글 드라이브를 연결하면 증빙 원본을 저장할 수 있어요. 목록 확인은 먼저 할 수 있습니다.</span></div>}
      {canceled && <div className="evidence-import-notice" role="status"><span>증빙 추가를 중단했습니다. 연결을 다시 확인하고 같은 묶음을 가져올 수 있어요.</span></div>}
      {error && <div className="alert error evidence-import-error" role="alert">{error}</div>}
    </section>
  );
}
