import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ, ArrowUpRight, Bookmark, CalendarDays, Check, Clapperboard,
  ExternalLink, FileText, FolderOpen, GraduationCap, Link2, LoaderCircle,
  PencilLine, Plus, Presentation, Search, SlidersHorizontal, Trash2, Users, X,
} from "lucide-react";
import { Modal } from "../CareerEditor";
import { displayLabel, LinkPicker, linkedRefs, RelatedLinks, TagsInput } from "./WorkspaceUI";
import type { MaterialItem, WorkspaceSectionProps } from "./types";
import "./MaterialsView.css";

const formats: MaterialItem["format"][] = ["PPT", "PDF", "영상", "기타"];
const audienceSuggestions = ["교원", "학생", "학부모", "관리자"];
type OwnershipFilter = "all" | MaterialItem["ownership"];

function newMaterial(): MaterialItem {
  return {
    id: "", kind: "material", title: "", tags: [], createdAt: "", updatedAt: "",
    ownership: "created", author: "", eventName: "", date: "", audience: [],
    format: "PPT", fileUrl: "", summary: "",
  };
}

function fileUrl(value: string) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !["drive.google.com", "docs.google.com"].includes(url.hostname)
      || url.username || url.password || url.port) return "";
    return url.href;
  } catch { return ""; }
}

function audienceValues(value: string) {
  return [...new Set(value.split(/[,，\n]/).map(part => part.trim()).filter(Boolean))];
}

function dateLabel(date: string) { return displayLabel(date.replace(/-/g, ".")); }
function ownLabel(ownership: MaterialItem["ownership"]) { return ownership === "created" ? "내가 만든 자료" : "모아둔 자료"; }
function FormatIcon({ format, size = 23 }: { format: MaterialItem["format"]; size?: number }) {
  if (format === "PPT") return <Presentation size={size} />;
  if (format === "영상") return <Clapperboard size={size} />;
  return <FileText size={size} />;
}

function MaterialEditor({ item, workspace, careers, onSave, onError, onClose }: {
  item: MaterialItem;
  onClose: () => void;
} & Pick<WorkspaceSectionProps, "workspace" | "careers" | "onSave" | "onError">) {
  const [draft, setDraft] = useState<MaterialItem>({ ...item, tags: [...item.tags], audience: [...item.audience] });
  const [baseRevision] = useState(workspace.revision);
  const [audience, setAudience] = useState(item.audience.join(", "));
  const [links, setLinks] = useState(item.id ? linkedRefs(workspace, `material:${item.id}`) : []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const change = <K extends keyof MaterialItem>(key: K, value: MaterialItem[K]) => setDraft(current => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    setError("");
    if (!draft.title.trim()) { setError("자료 제목을 입력해 주세요."); return; }
    if (draft.fileUrl.trim() && !fileUrl(draft.fileUrl)) {
      setError("구글 드라이브 또는 구글 문서의 https:// 링크를 입력해 주세요."); return;
    }
    const selectedAudience = audienceValues(audience);
    if (selectedAudience.length > 20 || selectedAudience.some(value => value.length > 100)) {
      setError("대상은 20개까지, 각 대상 이름은 100자 이내로 입력해 주세요."); return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await onSave({ ...draft, title: draft.title.trim(), audience: selectedAudience, fileUrl: fileUrl(draft.fileUrl) }, links, baseRevision);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자료를 저장하지 못했습니다. 다시 시도해 주세요.");
      onError(cause);
    } finally { busyRef.current = false; setBusy(false); }
  }

  return (
    <Modal title={item.id ? "강의 자료 수정" : "강의 자료 추가"} subtitle="자료의 맥락까지 적어두면 다음 강의 준비가 쉬워져요." wide onClose={() => !busyRef.current && onClose()}>
      <form onSubmit={event => void submit(event)}>
        <fieldset className="modal-body material-editor" disabled={busy}>
          <div className="field"><span>자료 구분</span>
            <div className="material-ownership-picker" role="group" aria-label="자료 구분">
              <button type="button" className={draft.ownership === "created" ? "selected" : ""} aria-pressed={draft.ownership === "created"} onClick={() => change("ownership", "created")}><PencilLine size={16} /> 내가 만든 자료{draft.ownership === "created" && <Check size={14} />}</button>
              <button type="button" className={draft.ownership === "collected" ? "selected" : ""} aria-pressed={draft.ownership === "collected"} onClick={() => change("ownership", "collected")}><Bookmark size={16} /> 모아둔 자료{draft.ownership === "collected" && <Check size={14} />}</button>
            </div>
          </div>
          <label className="field"><span>제목 <em className="material-required">필수</em></span><input value={draft.title} maxLength={300} placeholder="다시 찾기 쉬운 자료 제목" onChange={event => change("title", event.target.value)} required /></label>
          <div className="material-form-grid">
            <label className="field"><span>제작자 또는 출처</span><input value={draft.author} maxLength={300} placeholder={draft.ownership === "created" ? "제작자 이름" : "저자, 기관 또는 원문 출처"} onChange={event => change("author", event.target.value)} /></label>
            <label className="field"><span>사용한 행사 또는 강의</span><input value={draft.eventName} maxLength={300} placeholder="예: 교원 연수, 워크숍" onChange={event => change("eventName", event.target.value)} /></label>
            <label className="field"><span>자료 날짜</span><input type="date" value={draft.date} onChange={event => change("date", event.target.value)} /></label>
            <label className="field"><span>자료 형식</span><select aria-label="자료 형식" value={draft.format} onChange={event => change("format", event.target.value as MaterialItem["format"])}>{formats.map(format => <option key={format}>{format}</option>)}</select></label>
          </div>
          <div className="material-audience-field">
            <label className="field"><span>대상</span><input value={audience} placeholder="쉼표로 구분해 입력하세요" onChange={event => setAudience(event.target.value)} /></label>
            <div className="material-audience-suggestions" aria-label="대상 빠르게 선택">
              {audienceSuggestions.map(value => <button key={value} type="button" aria-pressed={audienceValues(audience).includes(value)} onClick={() => { const values = audienceValues(audience); setAudience((values.includes(value) ? values.filter(item => item !== value) : [...values, value]).join(", ")); }}>{audienceValues(audience).includes(value) ? <Check size={11} /> : <Plus size={11} />}{value}</button>)}
            </div>
          </div>
          <label className="field"><span>구글 드라이브 파일 링크</span><input value={draft.fileUrl} type="url" inputMode="url" placeholder="https://drive.google.com/..." autoComplete="off" onChange={event => change("fileUrl", event.target.value)} /><small>드라이브의 링크 복사 기능을 사용하세요. 구글 문서, 프레젠테이션 링크도 등록할 수 있어요.</small></label>
          <label className="field"><span>핵심 내용과 활용 메모</span><textarea value={draft.summary} rows={5} maxLength={20000} placeholder="어떤 내용인가요? 어느 강의에서 다시 활용하면 좋을까요?" onChange={event => change("summary", event.target.value)} /></label>
          <div className="material-editor-block"><TagsInput value={draft.tags} onChange={value => change("tags", value)} /></div>
          <div className="material-editor-block"><LinkPicker workspace={workspace} careers={careers} currentRef={item.id ? `material:${item.id}` : undefined} value={links} onChange={setLinks} /></div>
          {error && <div className="alert error" role="alert">{displayLabel(error)}<p>다른 곳에서 기록이 바뀌었다면 이 창을 닫고 최신 내용으로 다시 편집해 주세요.</p></div>}
        </fieldset>
        <div className="modal-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{busy ? "저장 중" : "자료 저장"}</button></div>
      </form>
    </Modal>
  );
}

export default function MaterialsView({ workspace, careers, onSave, onDelete, onOpen, focusId, onError }: WorkspaceSectionProps) {
  const [query, setQuery] = useState("");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [audience, setAudience] = useState("");
  const [format, setFormat] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("recent");
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState<MaterialItem | null>(null);
  const [deleting, setDeleting] = useState<MaterialItem | null>(null);
  const [deleteRevision, setDeleteRevision] = useState(workspace.revision);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteBusyRef = useRef(false);
  const materials = useMemo(() => workspace.items.filter((item): item is MaterialItem => item.kind === "material"), [workspace.items]);
  const selected = materials.find(item => item.id === selectedId);
  const createdCount = materials.filter(item => item.ownership === "created").length;
  const allAudiences = [...new Set(materials.flatMap(item => item.audience))].sort((a, b) => a.localeCompare(b, "ko"));
  const allTags = [...new Set(materials.flatMap(item => item.tags))].sort((a, b) => a.localeCompare(b, "ko"));
  const normalizedQuery = query.trim().normalize("NFC").toLocaleLowerCase("ko-KR");
  const filtered = materials.filter(item => {
    if (ownership !== "all" && item.ownership !== ownership || audience && !item.audience.includes(audience)
      || format && item.format !== format || tag && !item.tags.includes(tag)) return false;
    return !normalizedQuery || [item.title, item.author, item.eventName, item.summary, item.date, item.format, ...item.audience, ...item.tags]
      .join(" ").normalize("NFC").toLocaleLowerCase("ko-KR").includes(normalizedQuery);
  }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "ko") : sort === "date" ? b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  const hasFilters = Boolean(query || ownership !== "all" || audience || format || tag);
  const resetFilters = () => { setQuery(""); setOwnership("all"); setAudience(""); setFormat(""); setTag(""); };

  useEffect(() => {
    if (focusId && materials.some(item => item.id === focusId)) setSelectedId(focusId);
  }, [focusId, materials]);

  async function remove() {
    if (!deleting || deleteBusyRef.current) return;
    deleteBusyRef.current = true; setDeleteBusy(true); setDeleteError("");
    try { await onDelete(deleting.id, deleteRevision); setDeleting(null); setSelectedId(""); }
    catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "자료를 삭제하지 못했습니다. 다시 시도해 주세요."); onError(cause); }
    finally { deleteBusyRef.current = false; setDeleteBusy(false); }
  }

  return (
    <div className="materials-view">
      <div className="materials-heading">
        <div><span className="materials-eyebrow">MY TEACHING LIBRARY</span><h1>다음 강의를 위한 서가</h1><p>직접 만든 자료와 좋은 발견을 한곳에 모아두세요.</p></div>
        <button className="button primary" onClick={() => setEditing(newMaterial())}><Plus size={17} /> 자료 추가</button>
      </div>
      <div className="materials-collection-switch" role="group" aria-label="자료 구분 필터">
        <button aria-pressed={ownership === "all"} className={ownership === "all" ? "active" : ""} onClick={() => setOwnership("all")}><FolderOpen size={16} /><span>전체 자료</span><strong>{materials.length}</strong></button>
        <button aria-pressed={ownership === "created"} className={ownership === "created" ? "active" : ""} onClick={() => setOwnership("created")}><PencilLine size={16} /><span>내가 만든 자료</span><strong>{createdCount}</strong></button>
        <button aria-pressed={ownership === "collected"} className={ownership === "collected" ? "active" : ""} onClick={() => setOwnership("collected")}><Bookmark size={16} /><span>모아둔 자료</span><strong>{materials.length - createdCount}</strong></button>
      </div>
      <div className="materials-toolbar">
        <label className="materials-search"><Search size={17} /><input aria-label="강의 자료 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="제목, 제작자, 행사, 내용 검색" />{query && <button className="icon-button" aria-label="자료 검색어 지우기" onClick={() => setQuery("")}><X size={14} /></button>}</label>
        <div className="materials-select-filters"><SlidersHorizontal size={15} aria-hidden="true" />
          <select aria-label="자료 대상 필터" value={audience} onChange={event => setAudience(event.target.value)}><option value="">모든 대상</option>{allAudiences.map(value => <option key={value} value={value}>{displayLabel(value)}</option>)}</select>
          <select aria-label="자료 형식 필터" value={format} onChange={event => setFormat(event.target.value)}><option value="">모든 형식</option>{formats.map(value => <option key={value}>{value}</option>)}</select>
          <select aria-label="자료 태그 필터" value={tag} onChange={event => setTag(event.target.value)}><option value="">모든 태그</option>{allTags.map(value => <option key={value} value={value}>{displayLabel(value)}</option>)}</select>
        </div>
      </div>
      <div className="materials-results-header"><p>{hasFilters ? "찾은 자료" : "서가에 보관한 자료"} <strong>{filtered.length}</strong>개{hasFilters && <button className="text-button" onClick={resetFilters}>필터 초기화 <X size={12} /></button>}</p><label><ArrowDownAZ size={14} /><select aria-label="강의 자료 정렬" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">최근 수정순</option><option value="date">자료 날짜순</option><option value="title">제목순</option></select></label></div>
      {filtered.length ? (
        <div className="materials-grid">
          {filtered.map(item => <button type="button" className="material-card" key={item.id} onClick={() => setSelectedId(item.id)} aria-label={`${displayLabel(item.title)} 상세보기`}>
            <div className="material-card-top"><span className={`material-format-icon format-${formats.indexOf(item.format)}`}><FormatIcon format={item.format} /></span><span className={`material-ownership-badge ${item.ownership}`}>{item.ownership === "created" ? <PencilLine size={11} /> : <Bookmark size={11} />}{ownLabel(item.ownership)}</span></div>
            <span className="material-format-label">{item.format}{item.date && <span>{dateLabel(item.date)}</span>}</span>
            <h3>{displayLabel(item.title)}</h3>
            <p className="material-card-summary">{displayLabel(item.summary) || "자료를 다시 꺼내 쓸 때 도움이 될 메모를 남겨보세요."}</p>
            <div className="material-card-context">{item.author && <p><Users size={12} /><span>{displayLabel(item.author)}</span></p>}{item.eventName && <p><GraduationCap size={12} /><span>{displayLabel(item.eventName)}</span></p>}</div>
            <div className="material-card-footer"><div>{item.audience.length > 0 ? <span>{item.audience.map(displayLabel).join(", ")}</span> : <span className="material-unspecified">대상 미지정</span>}{item.tags.length > 0 && <span className="material-card-tags">{item.tags.slice(0, 3).map(value => `#${displayLabel(value)}`).join(" ")}{item.tags.length > 3 ? ` +${item.tags.length - 3}` : ""}</span>}</div><ArrowUpRight size={17} /></div>
          </button>)}
        </div>
      ) : (
        <div className="materials-empty"><span><Presentation size={31} /></span><h3>{materials.length ? "조건에 맞는 자료가 없어요" : "좋은 자료는 다시 꺼내 쓸 때 빛나요"}</h3><p>{materials.length ? "검색어나 필터를 바꿔보세요." : "첫 강의 자료를 등록하고, 활용한 경력이나 프로젝트와 연결해 보세요."}</p><button className="button secondary" onClick={materials.length ? resetFilters : () => setEditing(newMaterial())}>{materials.length ? <X size={15} /> : <Plus size={15} />}{materials.length ? "필터 초기화" : "첫 자료 추가하기"}</button></div>
      )}
      <p className="materials-storage-note"><Link2 size={14} />원본은 구글 드라이브에 두고, 여기에는 자료의 내용과 연결을 기록해요.</p>

      {selected && !editing && !deleting && (
        <Modal title={displayLabel(selected.title)} subtitle={ownLabel(selected.ownership)} wide onClose={() => setSelectedId("")}>
          <div className="modal-body material-detail">
            <div className="material-detail-feature"><span className={`material-format-icon format-${formats.indexOf(selected.format)}`}><FormatIcon format={selected.format} size={29} /></span><div><strong>{selected.format} 자료</strong><span>{selected.date ? dateLabel(selected.date) : "자료 날짜 미지정"}</span></div>{fileUrl(selected.fileUrl) ? <a className="button primary" href={fileUrl(selected.fileUrl)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={15} />드라이브에서 열기</a> : <span className="material-no-file">파일 링크 미등록</span>}</div>
            <dl className="material-detail-meta"><div><dt><Users size={14} />제작자 또는 출처</dt><dd>{displayLabel(selected.author) || "미등록"}</dd></div><div><dt><GraduationCap size={14} />행사 또는 강의</dt><dd>{displayLabel(selected.eventName) || "미등록"}</dd></div><div><dt><Users size={14} />대상</dt><dd>{selected.audience.map(displayLabel).join(", ") || "미지정"}</dd></div><div><dt><CalendarDays size={14} />자료 날짜</dt><dd>{selected.date ? dateLabel(selected.date) : "미지정"}</dd></div></dl>
            <section className="material-detail-notes"><h3><FileText size={16} />핵심 내용과 활용 메모</h3><p>{displayLabel(selected.summary) || "아직 메모가 없어요. 수정하기에서 활용 아이디어를 남겨보세요."}</p></section>
            {selected.tags.length > 0 && <div className="material-detail-tags">{selected.tags.map(value => <button key={value} onClick={() => { setTag(value); setSelectedId(""); }}>#{displayLabel(value)}</button>)}</div>}
            <section className="material-detail-links"><RelatedLinks workspace={workspace} careers={careers} currentRef={`material:${selected.id}`} onOpen={ref => { setSelectedId(""); onOpen(ref); }} /></section>
          </div>
          <div className="modal-footer material-detail-actions"><button className="text-button material-delete" onClick={() => { setDeleting(selected); setDeleteRevision(workspace.revision); setDeleteError(""); }}><Trash2 size={14} />삭제</button><button className="button secondary" onClick={() => setSelectedId("")}>닫기</button><button className="button primary" onClick={() => setEditing(selected)}><PencilLine size={15} />수정하기</button></div>
        </Modal>
      )}
      {editing && <MaterialEditor key={editing.id || "new-material"} item={editing} workspace={workspace} careers={careers} onSave={onSave} onError={onError} onClose={() => setEditing(null)} />}
      {deleting && <Modal title="강의 자료를 삭제할까요?" subtitle={displayLabel(deleting.title)} onClose={() => !deleteBusyRef.current && setDeleting(null)}><div className="modal-body"><p className="confirm-description">이 자료의 기록과 다른 항목과의 연결을 삭제합니다. 구글 드라이브 원본 파일은 유지됩니다.</p>{deleteError && <div className="alert error" role="alert">{displayLabel(deleteError)}<p>다른 곳에서 기록이 바뀌었다면 취소한 뒤 최신 내용을 확인해 주세요.</p></div>}</div><div className="modal-footer"><button className="button secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>취소</button><button className="button danger" disabled={deleteBusy} onClick={() => void remove()}>{deleteBusy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{deleteBusy ? "삭제 중" : "자료 삭제"}</button></div></Modal>}
    </div>
  );
}
