import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, ExternalLink, FileStack, FileText, LoaderCircle, PencilLine, Plus, Search, Trash2, Upload } from "lucide-react";
import { Modal } from "../CareerEditor";
import { download } from "../api";
import type { DocumentRecord } from "../types";
import { materialFileFormat } from "../../shared/material-classification.mjs";
import { RESEARCH_TYPES } from "../../shared/workspace.mjs";
import { displayLabel, LinkPicker, linkedRefs, RelatedLinks, TagsInput } from "./WorkspaceUI";
import type { MaterialItem, WorkspaceSectionProps } from "./types";
import "./ResearchView.css";

type ResearchType = NonNullable<MaterialItem["researchType"]>;
type Props = Omit<WorkspaceSectionProps, "onFiles" | "uploading" | "initialSubject"> & {
  documents: DocumentRecord[];
  onUploadFile: (file: File) => Promise<DocumentRecord>;
};
const ACCEPT = ".pdf,.ppt,.pptx,.hwp,.hwpx,.docx,.html,.htm,.txt,.xlsx,.cell,.jpg,.jpeg,.png,.webp";
export const isResearch = (item: { kind: string; purpose?: string }): item is MaterialItem => item.kind === "material" && item.purpose === "research";
export const researchTypeOf = (item: MaterialItem): ResearchType => item.researchType || "기타";
// Originals are ordinary archived documents; the item keeps name/size/SHA-256.
export const findResearchOriginal = (item: MaterialItem, documents: DocumentRecord[]) =>
  item.sourceFile ? documents.find(doc => doc.sha256 === item.sourceFile!.sha256 && doc.size === item.sourceFile!.size) : undefined;
const year = (item: MaterialItem) => item.date.slice(0, 4);
export const researchGroupKey = (item: MaterialItem) => JSON.stringify([year(item), item.eventName.trim()]);
export const researchGroupLabel = (item: MaterialItem) => [year(item) ? `${year(item)}년` : "", item.eventName.trim()].filter(Boolean).join(" ") || "대회와 연도 미입력";
const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
function emptyResearch(): MaterialItem {
  return { id: "", kind: "material", purpose: "research", researchType: "보고서", ownership: "created", title: "", eventName: "", date: "", author: "", tags: [], audience: [], format: "PDF", fileUrl: "", summary: "", createdAt: "", updatedAt: "" };
}

function ResearchEditor({ item, workspace, careers, onSave, onUploadFile, onClose }: Pick<Props, "workspace" | "careers" | "onSave" | "onUploadFile"> & { item: MaterialItem; onClose: () => void }) {
  const [draft, setDraft] = useState<MaterialItem>({ ...item, tags: [...item.tags] });
  const [file, setFile] = useState<File | null>(null);
  const [links, setLinks] = useState(item.id ? linkedRefs(workspace, `material:${item.id}`) : []);
  const [baseRevision] = useState(workspace.revision);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const saving = useRef(false);
  const change = <K extends keyof MaterialItem>(key: K, value: MaterialItem[K]) => setDraft(current => ({ ...current, [key]: value }));
  function selectFile(selected?: File) {
    if (!selected) return;
    if (!selected.size || selected.size > 25 * 1024 * 1024) { setError("비어 있지 않은 25 MB 이하의 파일을 선택해 주세요."); return; }
    setFile(selected); setError("");
    setDraft(current => ({ ...current, title: current.title || selected.name.normalize("NFC").replace(/\.[^.]+$/, ""), format: materialFileFormat(selected.name) }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    setError("");
    const yearText = draft.date.slice(0, 4);
    if (draft.date && !/^\d{4}$/.test(yearText)) { setError("연도는 네 자리 숫자로 입력해 주세요. 예: 2026"); return; }
    if (!file && !draft.sourceFile && !draft.fileUrl.trim()) { setError("보관할 원본 파일을 선택하거나 구글 드라이브 공유 링크를 입력해 주세요."); return; }
    if (draft.fileUrl.trim()) {
      try {
        const url = new URL(draft.fileUrl.trim());
        if (url.protocol !== "https:" || !["drive.google.com", "docs.google.com"].includes(url.hostname) || url.username || url.password || url.port) throw new Error();
      } catch { setError("구글 드라이브 또는 구글 문서의 HTTPS 공유 링크를 입력해 주세요."); return; }
    }
    saving.current = true; setBusy(true);
    try {
      let next: MaterialItem = { ...draft, purpose: "research", researchType: draft.researchType || "기타", fileUrl: draft.fileUrl.trim() };
      if (file) {
        const original = await onUploadFile(file);
        if (!original.sha256) throw new Error("원본 파일 확인 정보를 받지 못했습니다. 다시 시도해 주세요.");
        next = { ...next, sourceFile: { name: original.name, size: original.size, sha256: original.sha256 }, format: materialFileFormat(original.name) };
        setDraft(next); setFile(null);
      }
      await onSave(next, links, baseRevision);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "자료를 저장하지 못했습니다."); }
    finally { saving.current = false; setBusy(false); }
  }
  const contests = [...new Set(workspace.items.filter(isResearch).map(row => row.eventName.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  return <Modal title={`연구대회 자료 ${item.id ? "수정" : "보관"}`} wide onClose={() => !saving.current && onClose()}>
    <form onSubmit={event => void save(event)}><fieldset className="modal-body research-editor" disabled={busy}>
      <label className={`research-file-picker ${file || draft.sourceFile ? "chosen" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFile(event.dataTransfer.files?.[0]); }}>
        <Upload size={22} aria-hidden="true" />
        <strong>{displayLabel(file?.name || draft.sourceFile?.name || "원본 파일 선택 또는 끌어다 놓기")}</strong>
        <span>{file ? `${sizeLabel(file.size)}, 저장하면 보관합니다` : draft.sourceFile ? `${sizeLabel(draft.sourceFile.size)}, 다른 파일을 고르면 새 원본으로 바뀝니다` : "PDF, 한글, Word, PPT, Excel, 이미지, 최대 25 MB"}</span>
        <input type="file" aria-label="연구대회 원본 파일" accept={ACCEPT} onChange={event => { selectFile(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
      <label className="field"><span>자료 제목 *</span><input required maxLength={300} value={draft.title} onChange={event => change("title", event.target.value)} placeholder="예: 2026 현장교육연구대회 보고서 최종본" /></label>
      <div className="field research-type-field"><span id="research-type-label">자료 종류</span><div className="research-type-picker" role="radiogroup" aria-labelledby="research-type-label">
        {RESEARCH_TYPES.map(type => <button type="button" role="radio" key={type} aria-checked={(draft.researchType || "기타") === type} onClick={() => change("researchType", type)}>{displayLabel(type)}</button>)}
      </div></div>
      <div className="field-grid">
        <label className="field"><span>대회명 <small>선택</small></span><input maxLength={300} list="research-contests" value={draft.eventName} onChange={event => change("eventName", event.target.value)} placeholder="예: 교육자료전, 현장교육연구대회" /><datalist id="research-contests">{contests.map(name => <option key={name} value={name} />)}</datalist></label>
        <label className="field"><span>연도 <small>선택</small></span><input inputMode="numeric" maxLength={4} placeholder="예: 2026" value={draft.date.slice(0, 4)} onChange={event => change("date", event.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
      </div>
      <label className="field"><span>작성자 <small>선택</small></span><input maxLength={300} value={draft.author} onChange={event => change("author", event.target.value)} placeholder="공동 연구자가 있다면 함께 적어 주세요" /></label>
      <label className="field"><span>내용과 버전 메모 <small>선택</small></span><textarea rows={4} maxLength={20000} value={draft.summary} onChange={event => change("summary", event.target.value)} placeholder="연구 주제, 수정 사항, 제출 버전을 적어 두면 나중에 찾기 쉬워요." /></label>
      <label className="field"><span>구글 드라이브 공유 링크 <small>선택, 파일 대신 사용</small></span><input type="url" value={draft.fileUrl} placeholder="https://drive.google.com/..." onChange={event => change("fileUrl", event.target.value)} /></label>
      <TagsInput value={draft.tags} onChange={tags => change("tags", tags)} />
      <LinkPicker workspace={workspace} careers={careers} currentRef={item.id ? `material:${item.id}` : undefined} value={links} onChange={setLinks} />
      {error && <div className="alert error" role="alert">{error}</div>}
    </fieldset><div className="modal-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {busy ? "보관 중" : "자료 저장"}</button></div></form>
  </Modal>;
}

export default function ResearchView({ workspace, documents, careers, onSave, onDelete, onOpen, onError, onUploadFile, focusId, initialSection }: Props) {
  const items = useMemo(() => workspace.items.filter(isResearch), [workspace.items]);
  const [query, setQuery] = useState(""), [contest, setContest] = useState("");
  const [type, setType] = useState<ResearchType | "">(RESEARCH_TYPES.includes(initialSection as ResearchType) ? initialSection as ResearchType : "");
  const [selectedId, setSelectedId] = useState(""), [editing, setEditing] = useState<MaterialItem | null>(null);
  const [deleting, setDeleting] = useState<{ item: MaterialItem; revision: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const selected = items.find(item => item.id === selectedId);
  useEffect(() => { if (focusId && items.some(item => item.id === focusId)) setSelectedId(focusId); }, [focusId, items]);
  const contests = useMemo(() => [...new Map(items.map(item => [researchGroupKey(item), researchGroupLabel(item)])).entries()].sort((a, b) => b[1].localeCompare(a[1], "ko")), [items]);
  const words = query.trim().normalize("NFC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchesExceptType = (item: MaterialItem) => (!contest || researchGroupKey(item) === contest)
    && words.every(word => [item.title, item.eventName, item.author, item.summary, item.sourceFile?.name || "", researchTypeOf(item), ...item.tags].join(" ").normalize("NFC").toLocaleLowerCase().includes(word));
  const filtered = items.filter(item => matchesExceptType(item) && (!type || researchTypeOf(item) === type));
  // Newest year first; inside a contest, by document type order then latest edit.
  const groups = [...filtered.reduce((map, item) => map.set(researchGroupKey(item), [...(map.get(researchGroupKey(item)) || []), item]), new Map<string, MaterialItem[]>()).entries()]
    .map(([key, rows]) => ({ key, label: researchGroupLabel(rows[0]), rows: rows.sort((a, b) => RESEARCH_TYPES.indexOf(researchTypeOf(a)) - RESEARCH_TYPES.indexOf(researchTypeOf(b)) || b.updatedAt.localeCompare(a.updatedAt)) }))
    .sort((a, b) => (year(b.rows[0]) || "0").localeCompare(year(a.rows[0]) || "0") || a.label.localeCompare(b.label, "ko"));
  const stored = items.filter(item => findResearchOriginal(item, documents)).length;
  async function original(item: MaterialItem) {
    const doc = findResearchOriginal(item, documents);
    if (!doc || busy) return;
    setBusy(true);
    try { await download(`/documents/${doc.id}/file`, doc.name); }
    catch (cause) { onError(cause); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError("");
    try { await onDelete(deleting.item.id, deleting.revision); setDeleting(null); setSelectedId(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다."); }
    finally { setBusy(false); }
  }
  const status = (item: MaterialItem) => findResearchOriginal(item, documents) ? "원본 보관됨" : item.fileUrl ? "드라이브 링크" : item.sourceFile ? "원본 확인 필요" : "원본 없음";
  return <section className="research-view">
    <header className="research-heading">
      <div><h1>연구대회 자료 <small>{items.length}</small></h1><p>내가 만든 계획서, 보고서, 발표자료를 대회와 연도별로 모아 두세요.</p></div>
      <button className="button primary" onClick={() => setEditing(emptyResearch())}><Plus size={17} />자료 보관</button>
    </header>
    <div className="research-summary" aria-label="연구대회 자료 요약">
      <span><FileStack size={18} aria-hidden="true" /><strong>{items.length}</strong>개 자료</span>
      <span><FileText size={18} aria-hidden="true" /><strong>{stored}</strong>개 원본 보관</span>
      <span><strong>{contests.length}</strong>개 대회</span>
    </div>
    <div className="research-type-filter" role="group" aria-label="자료 종류로 거르기">
      <button aria-pressed={!type} onClick={() => setType("")}>전체 <small>{items.filter(matchesExceptType).length}</small></button>
      {RESEARCH_TYPES.map(value => <button key={value} aria-pressed={type === value} onClick={() => setType(type === value ? "" : value)}>{displayLabel(value)} <small>{items.filter(item => matchesExceptType(item) && researchTypeOf(item) === value).length}</small></button>)}
    </div>
    <div className="research-toolbar">
      <label className="search-box"><Search size={17} aria-hidden="true" /><input aria-label="연구대회 자료 검색" placeholder="제목, 대회명, 작성자, 메모, 태그 검색" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="select-wrap"><select aria-label="대회 거르기" value={contest} onChange={event => setContest(event.target.value)}><option value="">모든 대회</option>{contests.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <p className="research-count" aria-live="polite">{query || contest || type ? "찾은 자료" : "전체 자료"} {filtered.length}개</p>
    {groups.length ? groups.map(group => <section className="research-group" key={group.key} aria-label={group.label}>
      <h2>{displayLabel(group.label)} <small>{group.rows.length}개</small></h2>
      <div className="research-grid">{group.rows.map(item => <article className="research-card" key={item.id}>
        <button className="research-card-open" onClick={() => setSelectedId(item.id)} aria-label={`${item.title} 자세히 보기`}>
          <span className="research-card-meta"><span className={`research-type type-${RESEARCH_TYPES.indexOf(researchTypeOf(item))}`}>{displayLabel(researchTypeOf(item))}</span><small>{item.format}</small></span>
          <h3>{displayLabel(item.title)}</h3>
          {(item.summary || item.sourceFile?.name) && <p>{displayLabel(item.summary || item.sourceFile?.name || "")}</p>}
          <span className="research-card-footer"><FileText size={15} aria-hidden="true" /><span className={findResearchOriginal(item, documents) ? "ok" : item.fileUrl ? "link" : "warn"}>{status(item)}</span>{linkedRefs(workspace, `material:${item.id}`).length > 0 && <small>관련 기록 {linkedRefs(workspace, `material:${item.id}`).length}</small>}</span>
        </button>
      </article>)}</div>
    </section>) : <div className="research-empty"><FileStack size={36} aria-hidden="true" /><h2>{items.length ? "조건에 맞는 자료가 없어요" : "첫 연구대회 자료를 보관해 보세요"}</h2><p>{items.length ? "검색어나 거르기 조건을 바꿔 보세요." : "원본 파일만 고르면 돼요. 대회명과 연도는 나중에 적어도 됩니다."}</p>{!items.length && <button className="button secondary" onClick={() => setEditing(emptyResearch())}><Plus size={16} />자료 보관</button>}</div>}
    {selected && <Modal title={displayLabel(selected.title)} subtitle={displayLabel(researchGroupLabel(selected))} wide onClose={() => !busy && setSelectedId("")}>
      <div className="modal-body research-detail">
        <div className="research-detail-meta"><span className={`research-type type-${RESEARCH_TYPES.indexOf(researchTypeOf(selected))}`}>{displayLabel(researchTypeOf(selected))}</span><span>{selected.format}</span>{selected.author && <span>{displayLabel(selected.author)}</span>}</div>
        <section className="research-original"><FileText size={24} aria-hidden="true" /><div><strong>{displayLabel(selected.sourceFile?.name || (selected.fileUrl ? "구글 드라이브 링크" : "원본 파일 없음"))}</strong><small>{selected.sourceFile ? sizeLabel(selected.sourceFile.size) : selected.fileUrl ? "링크로 열 수 있어요." : "자료 수정에서 원본을 추가할 수 있어요."}</small></div>
          {findResearchOriginal(selected, documents) && <button className="button secondary" disabled={busy} onClick={() => void original(selected)}><ArrowDownToLine size={16} />원본 받기</button>}
          {selected.fileUrl && <a className="button secondary" href={selected.fileUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />드라이브에서 열기</a>}
        </section>
        {selected.sourceFile && !findResearchOriginal(selected, documents) && <p className="alert" role="status">보관된 원본을 찾지 못했어요. 자료 수정에서 파일을 다시 고르거나, 원본이 들어 있는 백업으로 복원해 주세요.</p>}
        {selected.summary && <section><h3>내용과 버전 메모</h3><p className="research-notes">{displayLabel(selected.summary)}</p></section>}
        {selected.tags.length > 0 && <div className="tags">{selected.tags.map(tag => <span key={tag}>#{displayLabel(tag)}</span>)}</div>}
        <RelatedLinks workspace={workspace} careers={careers} currentRef={`material:${selected.id}`} onOpen={onOpen} />
      </div>
      <div className="modal-footer"><button className="button secondary danger-text" disabled={busy} onClick={() => { setError(""); setDeleting({ item: selected, revision: workspace.revision }); setSelectedId(""); }}><Trash2 size={16} />자료 삭제</button><button className="button primary" disabled={busy} onClick={() => { setEditing(selected); setSelectedId(""); }}><PencilLine size={16} />자료 수정</button></div>
    </Modal>}
    {editing && <ResearchEditor item={editing} workspace={workspace} careers={careers} onSave={onSave} onUploadFile={onUploadFile} onClose={() => setEditing(null)} />}
    {deleting && <Modal title="연구대회 자료를 삭제할까요?" onClose={() => !busy && setDeleting(null)}><div className="modal-body"><p><strong>{displayLabel(deleting.item.title)}</strong> 자료 정보와 관련 기록 연결을 지웁니다.</p><p>원본 파일은 공문 보관함에 그대로 남아요.</p>{error && <div role="alert" className="alert error">{error}</div>}</div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={() => setDeleting(null)}>취소</button><button className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? "삭제 중" : "자료 삭제"}</button></div></Modal>}
  </section>;
}
