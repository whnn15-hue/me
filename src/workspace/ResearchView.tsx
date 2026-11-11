import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, ExternalLink, FileText, FolderOpen, LoaderCircle, PencilLine, Plus, Search, Trash2, Upload } from "lucide-react";
import { Modal } from "../CareerEditor";
import { download } from "../api";
import type { DocumentRecord } from "../types";
import { materialFileFormat } from "../../shared/material-classification.mjs";
import { displayLabel, LinkPicker, linkedRefs, RelatedLinks, TagsInput } from "./WorkspaceUI";
import type { MaterialItem, WorkspaceSectionProps } from "./types";
import "./ResearchView.css";

const documentTypes: NonNullable<MaterialItem["researchType"]>[] = ["계획서", "보고서", "발표자료", "부록·증빙", "참고자료", "기타"];
type Props = WorkspaceSectionProps & {
  documents: DocumentRecord[];
  onUploadFile: (file: File) => Promise<DocumentRecord>;
};
const isResearch = (item: {kind: string; purpose?: string}): item is MaterialItem => item.kind === "material" && item.purpose === "research";
const findOriginal = (item: MaterialItem, documents: DocumentRecord[]) => item.sourceFile && documents.find(doc => doc.sha256 === item.sourceFile!.sha256 && doc.size === item.sourceFile!.size);
const groupKey = (item: MaterialItem) => JSON.stringify([item.date.slice(0, 4), item.eventName.trim()]);
const groupLabel = (item: MaterialItem) => [item.date.slice(0, 4), item.eventName || "대회명 미입력"].filter(Boolean).join(" · ");
function emptyMaterial(): MaterialItem {
  return { id: "", kind: "material", purpose: "research", researchType: "보고서", ownership: "created", title: "", eventName: "", date: "", author: "", tags: [], audience: [], format: "PDF", fileUrl: "", summary: "", createdAt: "", updatedAt: "" };
}

function ResearchEditor({item, workspace, careers, onSave, onUploadFile, onClose}: Pick<Props, "workspace" | "careers" | "onSave" | "onUploadFile"> & {item: MaterialItem; onClose: () => void}) {
  const [draft, setDraft] = useState({...item, tags: [...item.tags]});
  const [file, setFile] = useState<File | null>(null);
  const [links, setLinks] = useState(item.id ? linkedRefs(workspace, `material:${item.id}`) : []);
  const [baseRevision] = useState(workspace.revision);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const saving = useRef(false);
  const change = <K extends keyof MaterialItem>(key: K, value: MaterialItem[K]) => setDraft(current => ({...current, [key]: value}));
  function selectFile(selected?: File) {
    if (!selected) return;
    if (!selected.size || selected.size > 25 * 1024 * 1024) { setError("비어 있지 않은 25 MB 이하의 파일을 선택해 주세요."); return; }
    setFile(selected); setError("");
    setDraft(current => ({...current, title: current.title || selected.name.replace(/\.[^.]+$/, ""), format: materialFileFormat(selected.name)}));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    setError("");
    if (!file && !draft.sourceFile && !draft.fileUrl.trim()) { setError("보관할 원본 파일을 선택하거나 구글 드라이브 링크를 입력해 주세요."); return; }
    if (draft.fileUrl.trim()) {
      try {
        const url = new URL(draft.fileUrl);
        if (url.protocol !== "https:" || !["drive.google.com", "docs.google.com"].includes(url.hostname) || url.username || url.password || url.port) throw new Error();
      } catch { setError("구글 드라이브 또는 구글 문서의 HTTPS 링크를 입력해 주세요."); return; }
    }
    saving.current = true; setBusy(true);
    try {
      let next = draft;
      if (file) {
        const original = await onUploadFile(file);
        if (!original.sha256) throw new Error("원본 파일 확인 정보를 받지 못했습니다. 다시 시도해 주세요.");
        next = {...draft, sourceFile: {name: original.name, size: original.size, sha256: original.sha256}, format: materialFileFormat(original.name)};
        setDraft(next); setFile(null);
      }
      await onSave(next, links, baseRevision);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "자료를 저장하지 못했습니다."); }
    finally { saving.current = false; setBusy(false); }
  }
  const contests = [...new Set(workspace.items.filter(isResearch).map(row => row.eventName).filter(Boolean))];
  return <Modal title={`연구대회 자료 ${item.id ? "수정" : "보관"}`} wide onClose={() => !saving.current && onClose()}>
    <form onSubmit={event => void save(event)}><fieldset className="modal-body research-editor" disabled={busy}>
      <div className="field-grid"><label className="field"><span>대회명 <small>선택</small></span><input maxLength={300} list="research-contests" value={draft.eventName} onChange={event => change("eventName", event.target.value)} placeholder="예: 교육자료전, 현장교육연구대회"/><datalist id="research-contests">{contests.map(name => <option key={name} value={name}/>)}</datalist></label><label className="field"><span>연도</span><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="예: 2026" value={draft.date.slice(0, 4)} onChange={event => change("date", event.target.value)}/></label></div>
      <label className="field"><span>자료 제목 *</span><input required maxLength={300} value={draft.title} onChange={event => change("title", event.target.value)} placeholder="연구 주제와 버전을 적어 주세요"/></label>
      <div className="field-grid"><label className="field"><span>자료 종류</span><select value={draft.researchType || "기타"} onChange={event => change("researchType", event.target.value as MaterialItem["researchType"])}>{documentTypes.map(type => <option key={type}>{type}</option>)}</select></label><label className="field"><span>작성자</span><input maxLength={300} value={draft.author} onChange={event => change("author", event.target.value)}/></label></div>
      <label className="research-file-picker"><Upload size={22}/><strong>{file?.name || draft.sourceFile?.name || "원본 파일 선택"}</strong><span>PDF, HWP/HWPX, Word, PPT, Excel, TXT, 이미지 · 최대 25 MB</span><input type="file" aria-label="연구대회 원본 파일" accept=".pdf,.hwp,.hwpx,.docx,.ppt,.pptx,.xlsx,.cell,.txt,.html,.htm,.png,.jpg,.jpeg,.webp" onChange={event => {selectFile(event.target.files?.[0]); event.target.value = "";}}/></label>
      <label className="field"><span>구글 드라이브 링크 <small>선택</small></span><input type="url" value={draft.fileUrl} placeholder="https://drive.google.com/..." onChange={event => change("fileUrl", event.target.value)}/></label>
      <label className="field"><span>내용과 버전 메모</span><textarea rows={4} maxLength={20000} value={draft.summary} onChange={event => change("summary", event.target.value)} placeholder="연구 주제, 수정 사항, 제출 버전을 기록하세요."/></label>
      <TagsInput value={draft.tags} onChange={tags => change("tags", tags)}/>
      <LinkPicker workspace={workspace} careers={careers} currentRef={item.id ? `material:${item.id}` : undefined} value={links} onChange={setLinks}/>
      {error && <div className="alert error" role="alert">{error}</div>}
    </fieldset><div className="modal-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} {busy ? "보관 중" : "자료 저장"}</button></div></form>
  </Modal>;
}

export default function ResearchView({workspace, documents, careers, onSave, onDelete, onOpen, onError, onUploadFile, focusId, initialSection}: Props) {
  const items = workspace.items.filter(isResearch);
  const [query, setQuery] = useState(""), [contest, setContest] = useState(""), [type, setType] = useState(initialSection || "");
  const [selectedId, setSelectedId] = useState(""), [editing, setEditing] = useState<MaterialItem | null>(null);
  const [deleting, setDeleting] = useState<{item: MaterialItem; revision: number} | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const selected = items.find(item => item.id === selectedId);
  useEffect(() => { if (focusId) setSelectedId(focusId); }, [focusId]);
  const groups = [...new Map(items.map(item => [groupKey(item), groupLabel(item)])).entries()].sort((a,b) => b[1].localeCompare(a[1], "ko"));
  const words = query.trim().normalize("NFC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = items.filter(item => (!contest || groupKey(item) === contest) && (!type || (item.researchType || "기타") === type) && words.every(word => [item.title, item.eventName, item.author, item.summary, item.sourceFile?.name || "", ...item.tags].join(" ").normalize("NFC").toLocaleLowerCase().includes(word))).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  async function original(item: MaterialItem) {
    const doc = findOriginal(item, documents);
    if (!doc) return;
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
  return <section className="research-view">
    <header className="research-heading"><div><span className="library-kicker">RESEARCH ARCHIVE</span><h1>연구대회 자료 <small>{items.length}</small></h1><p>내가 만든 계획서, 보고서, 발표자료를 파일별로 보관하세요.</p></div><button className="button primary" onClick={() => setEditing(emptyMaterial())}><Plus size={17}/>파일 보관</button></header>
    <div className="research-summary"><span><FolderOpen size={18}/><strong>{items.length}</strong>개 자료</span><span><FileText size={18}/><strong>{items.filter(item => findOriginal(item, documents)).length}</strong>개 원본 보관</span><span>계획서 · 보고서 · 발표자료 · 부록과 증빙</span></div>
    <div className="research-toolbar"><label className="search-box"><Search size={17}/><input aria-label="연구대회 자료 검색" placeholder="제목, 대회명, 작성자, 메모 검색" value={query} onChange={event => setQuery(event.target.value)}/></label><select aria-label="연구대회 필터" value={contest} onChange={event => setContest(event.target.value)}><option value="">모든 대회</option>{groups.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="연구대회 자료 종류 필터" value={type} onChange={event => setType(event.target.value)}><option value="">모든 자료 종류</option>{documentTypes.map(value => <option key={value}>{value}</option>)}</select></div>
    <p className="research-count" aria-live="polite">{query || contest || type ? "찾은 자료" : "전체 자료"} {filtered.length}개</p>
    {filtered.length ? <div className="research-grid">{filtered.map(item => <article className="research-card" key={item.id}><button className="research-card-open" onClick={() => setSelectedId(item.id)} aria-label={`${item.title} 상세보기`}><span className="research-card-meta"><span>{item.researchType || "기타"}</span><small>{item.format}</small></span><h3>{displayLabel(item.title)}</h3>{(item.eventName || item.date) && <small className="research-contest-label">{displayLabel(groupLabel(item))}</small>}<p>{displayLabel(item.summary || item.sourceFile?.name || "드라이브에 보관한 자료")}</p><span className="research-card-footer"><FileText size={14}/>{findOriginal(item, documents) ? "원본 보관됨" : item.fileUrl ? "드라이브 링크" : "원본 확인 필요"}{linkedRefs(workspace, `material:${item.id}`).length > 0 && <small>관련 기록 {linkedRefs(workspace, `material:${item.id}`).length}</small>}</span></button></article>)}</div> : <div className="research-empty"><FolderOpen size={36}/><h2>{items.length ? "조건에 맞는 자료가 없습니다" : "첫 연구대회 자료를 보관해 보세요"}</h2><p>{items.length ? "검색어나 필터를 바꿔 보세요." : "원본 파일을 선택해 보관하세요. 대회명과 연도는 나중에 적어도 됩니다."}</p>{!items.length && <button className="button secondary" onClick={() => setEditing(emptyMaterial())}><Plus size={16}/>파일 보관</button>}</div>}
    {selected && <Modal title={selected.title} subtitle={selected.eventName || selected.date ? groupLabel(selected) : "개별 보관 자료"} wide onClose={() => !busy && setSelectedId("")}><div className="modal-body research-detail"><div className="research-detail-meta"><span>{selected.researchType || "기타"}</span><span>{selected.format}</span>{selected.author && <span>{displayLabel(selected.author)}</span>}</div>{selected.summary && <section><h3>내용과 버전 메모</h3><p className="research-notes">{displayLabel(selected.summary)}</p></section>}<section className="research-original"><FileText size={24}/><div><strong>{displayLabel(selected.sourceFile?.name || "원본 파일 미등록")}</strong><small>{selected.sourceFile ? `${Math.ceil(selected.sourceFile.size / 1024)} KB` : "드라이브 링크로 열 수 있어요."}</small></div>{findOriginal(selected, documents) && <button className="button secondary" disabled={busy} onClick={() => void original(selected)}><ArrowDownToLine size={16}/>원본 다운로드</button>}</section>{selected.sourceFile && !findOriginal(selected, documents) && <p role="status">원본 파일을 찾을 수 없습니다. 자료 수정에서 파일을 다시 선택하거나 원본이 포함된 ZIP 백업으로 복원해 주세요.</p>}{selected.fileUrl && <a className="button secondary" href={selected.fileUrl} target="_blank" rel="noreferrer"><ExternalLink size={16}/>드라이브에서 열기</a>}<div className="tags">{selected.tags.map(tag => <span key={tag}>#{displayLabel(tag)}</span>)}</div><RelatedLinks workspace={workspace} careers={careers} currentRef={`material:${selected.id}`} onOpen={onOpen}/></div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={() => {setError("");setDeleting({item:selected, revision:workspace.revision});setSelectedId("");}}><Trash2 size={16}/>자료 삭제</button><button className="button primary" disabled={busy} onClick={() => {setEditing(selected);setSelectedId("");}}><PencilLine size={16}/>자료 수정</button></div></Modal>}
    {editing && <ResearchEditor item={editing} workspace={workspace} careers={careers} onSave={onSave} onUploadFile={onUploadFile} onClose={() => setEditing(null)}/>}
    {deleting && <Modal title="연구대회 자료를 삭제할까요?" onClose={() => !busy && setDeleting(null)}><div className="modal-body"><p><strong>{displayLabel(deleting.item.title)}</strong> 자료와 관련 기록 연결을 삭제합니다.</p><p>원본 파일은 공문 보관함에 남습니다.</p>{error && <div role="alert" className="alert error">{error}</div>}</div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={() => setDeleting(null)}>취소</button><button className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? "삭제 중" : "자료 삭제"}</button></div></Modal>}
  </section>;
}
