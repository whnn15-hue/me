import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownAZ, ArrowUpRight, Code2, Star, CalendarDays, Check, Clapperboard,
  ExternalLink, FileText, GraduationCap, Link2, LoaderCircle,
  PencilLine, Plus, Presentation, Search, SlidersHorizontal, Trash2, Users, X,
} from "lucide-react";
import HtmlPreview from "./HtmlPreview";
import { FavoriteButton, useFavorites, useLibraryView, ViewSwitch } from "./LibraryControls";
import FileDropzone from "../FileDropzone";
import { materialClassification, materialSubjects, materialTrainings } from "../../shared/material-classification.mjs";
import { Modal } from "../CareerEditor";
import { displayLabel, LinkPicker, linkedRefs, RelatedLinks, TagsInput } from "./WorkspaceUI";
import type { MaterialItem, WorkspaceSectionProps } from "./types";
import "./MaterialsView.css";

const formats: MaterialItem["format"][] = ["PPT", "PDF", "영상", "기타", "HWP", "TXT", "HTML"];
const audienceSuggestions = ["교원", "학생", "학부모", "관리자"];


function newMaterial(purpose: "classroom" | "lecture"): MaterialItem {
  return {
    id: "", kind: "material", title: "", tags: [], createdAt: "", updatedAt: "",
    ownership: "created", author: "", eventName: "", date: "", audience: [],
    format: "PPT", fileUrl: "", summary: "",
    ...(purpose === "classroom" ? { purpose } : {}),
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
function ClassificationPicker({draft,onChange}: {draft:MaterialItem;onChange:(field:"subjects"|"trainings",values:string[])=>void}) {
  const current=materialClassification(draft);
  return <details className="classification-options"><summary>{[...current.subjects,...current.trainings].join(", ") || "과목과 기초훈련 선택"}</summary><div className="classification-editor">{([['subjects','과목',materialSubjects],['trainings','기초훈련',materialTrainings]] as const).map(([field,label,values]) => <fieldset key={field}><legend>{label}</legend><div>{values.map(value => <label key={value} className={current[field].includes(value)?'selected':''}><input type="checkbox" checked={current[field].includes(value)} onChange={event => onChange(field,event.target.checked?[...current[field],value]:current[field].filter(item=>item!==value))}/>{value}</label>)}</div></fieldset>)}</div></details>;
}
function FormatIcon({ format, size = 23 }: { format: MaterialItem["format"]; size?: number }) {
  if (format === "HTML") return <Code2 size={size} />;
  if (format === "PPT") return <Presentation size={size} />;
  if (format === "영상") return <Clapperboard size={size} />;
  return <FileText size={size} />;
}

function MaterialEditor({ item, workspace, careers, onSave, onError, onClose }: {
  item: MaterialItem;
  onClose: () => void;
} & Pick<WorkspaceSectionProps, "workspace" | "careers" | "onSave" | "onError">) {
  const classroom = item.purpose === "classroom";
  const materialLabel = classroom ? "학급 자료" : "강의 자료";
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
      await onSave({ ...draft, ...(!draft.id ? materialClassification(draft) : {}), title: draft.title.trim(), audience: selectedAudience, fileUrl: fileUrl(draft.fileUrl) }, links, baseRevision);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자료를 저장하지 못했습니다. 다시 시도해 주세요.");
      onError(cause);
    } finally { busyRef.current = false; setBusy(false); }
  }

  return (
    <Modal title={`${materialLabel} ${item.id ? "수정" : "추가"}`} wide onClose={() => !busyRef.current && onClose()}>
      <form onSubmit={event => void submit(event)}>
        <fieldset className="modal-body material-editor" disabled={busy}>
          <label className="field"><span>제목 <em className="material-required">필수</em></span><input value={draft.title} maxLength={300} placeholder="다시 찾기 쉬운 자료 제목" onChange={event => change("title", event.target.value)} required /></label>
          <ClassificationPicker draft={draft} onChange={(field,values)=>change(field,values)} />
          <label className="field"><span>구글 드라이브 파일 링크</span><input value={draft.fileUrl} type="url" inputMode="url" placeholder="https://drive.google.com/..." autoComplete="off" onChange={event => change("fileUrl", event.target.value)} /><small>드라이브의 링크 복사 기능을 사용하세요. 구글 문서, 프레젠테이션 링크도 등록할 수 있어요.</small></label>
          <details className="optional-fields"><summary>추가 정보와 기록 연결</summary>
          <div className="material-form-grid">
            <label className="field"><span>제작자 또는 출처</span><input value={draft.author} maxLength={300} placeholder={draft.ownership === "created" ? "제작자 이름" : "저자, 기관 또는 원문 출처"} onChange={event => change("author", event.target.value)} /></label>
            <label className="field"><span>{classroom ? "사용한 수업 또는 활동" : "사용한 행사 또는 강의"}</span><input value={draft.eventName} maxLength={300} placeholder={classroom ? "예: 아침 활동, 국어 말하기 수업" : "예: 교원 연수, 워크숍"} onChange={event => change("eventName", event.target.value)} /></label>
            <label className="field"><span>자료 날짜</span><input type="date" value={draft.date} onChange={event => change("date", event.target.value)} /></label>
            <label className="field"><span>자료 형식</span><select aria-label="자료 형식" value={draft.format} onChange={event => change("format", event.target.value as MaterialItem["format"])}>{formats.map(format => <option key={format}>{format}</option>)}</select></label>
          </div>
          <div className="material-audience-field">
            <label className="field"><span>대상</span><input value={audience} placeholder="쉼표로 구분해 입력하세요" onChange={event => setAudience(event.target.value)} /></label>
            <div className="material-audience-suggestions" aria-label="대상 빠르게 선택">
              {audienceSuggestions.map(value => <button key={value} type="button" aria-pressed={audienceValues(audience).includes(value)} onClick={() => { const values = audienceValues(audience); setAudience((values.includes(value) ? values.filter(item => item !== value) : [...values, value]).join(", ")); }}>{audienceValues(audience).includes(value) ? <Check size={11} /> : <Plus size={11} />}{value}</button>)}
            </div>
          </div>

          <label className="field"><span>핵심 내용과 활용 메모</span><textarea value={draft.summary} rows={5} maxLength={20000} placeholder={classroom ? "활동 방법, 준비물, 다음 수업에서 활용할 아이디어를 남겨주세요." : "어떤 내용인가요? 어느 강의에서 다시 활용하면 좋을까요?"} onChange={event => change("summary", event.target.value)} /></label>
          <div className="material-editor-block"><TagsInput value={draft.tags} onChange={value => change("tags", value)} /></div>
          <div className="material-editor-block"><LinkPicker workspace={workspace} careers={careers} currentRef={item.id ? `material:${item.id}` : undefined} value={links} onChange={setLinks} /></div>
          </details>
          {error && <div className="alert error" role="alert">{displayLabel(error)}<p>다른 곳에서 기록이 바뀌었다면 이 창을 닫고 최신 내용으로 다시 편집해 주세요.</p></div>}
        </fieldset>
        <div className="modal-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{busy ? "저장 중" : "자료 저장"}</button></div>
      </form>
    </Modal>
  );
}

export interface MaterialsViewProps extends WorkspaceSectionProps {
  purpose?: "classroom" | "lecture";
  importPanel?: ReactNode;
}

export default function MaterialsView({ workspace, careers, onSave, onDelete, onOpen, focusId, onError, purpose = "lecture", importPanel, onFiles, uploading, loadHtmlPreview, initialSection, initialSubject }: MaterialsViewProps) {
  const classroom = purpose === "classroom";
  const materialLabel = classroom ? "학급 자료" : "강의 자료";
  const [view, setView] = useLibraryView(`materials-${purpose}`);
  const [quick, setQuick] = useState(initialSection === "favorites" ? "favorites" : "all");
  const favorites = useFavorites({ workspace, onSave, onError });
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState(initialSubject || "");
  const [training, setTraining] = useState("");
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
  const materials = useMemo(() => workspace.items.filter((item): item is MaterialItem => item.kind === "material" && (item.purpose ?? "lecture") === purpose), [workspace.items, purpose]);
  const selected = materials.find(item => item.id === selectedId);
  const classified = new Map(materials.map(item => [item.id, materialClassification(item)]));
  const allSubjects = [...new Set(materials.flatMap(item => classified.get(item.id)!.subjects))].sort((a,b)=>a.localeCompare(b,"ko"));
  const allAudiences = [...new Set(materials.flatMap(item => item.audience))].sort((a, b) => a.localeCompare(b, "ko"));
  const allTags = [...new Set(materials.flatMap(item => item.tags))].sort((a, b) => a.localeCompare(b, "ko"));
  const normalizedQuery = query.trim().normalize("NFC").toLocaleLowerCase("ko-KR");
  const filtered = materials.filter(item => {
    if (quick === "favorites" && !item.favorite || quick === "linked" && !fileUrl(item.fileUrl) || quick === "missing" && fileUrl(item.fileUrl)) return false;
    if (subject && (subject === "unclassified" ? classified.get(item.id)!.subjects.length > 0 : !classified.get(item.id)!.subjects.includes(subject)) || training && !classified.get(item.id)!.trainings.includes(training) || audience && !item.audience.includes(audience)
      || format && item.format !== format || tag && !item.tags.includes(tag)) return false;
    return !normalizedQuery || [item.title, item.author, item.eventName, item.summary, item.date, item.format, ...classified.get(item.id)!.subjects, ...classified.get(item.id)!.trainings, ...item.audience, ...item.tags]
      .join(" ").normalize("NFC").toLocaleLowerCase("ko-KR").includes(normalizedQuery);
  }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "ko") : sort === "date" ? b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  const hasFilters = Boolean(query || subject || training || audience || format || tag || quick !== "all");
  const resetFilters = () => { setQuick("all"); setQuery(""); setSubject(""); setTraining(""); setAudience(""); setFormat(""); setTag(""); };

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
        <div><span className="library-kicker">{classroom ? "CLASSROOM LIBRARY" : "LECTURE LIBRARY"}</span><h1>{materialLabel}<span className="library-total" aria-hidden="true">{materials.length}</span></h1></div>
        <button className="button primary" onClick={() => setEditing(newMaterial(purpose))}><Plus size={17} /> 자료 추가</button>
      </div>
      {onFiles && <FileDropzone onFiles={files=>onFiles(files,purpose)} busy={uploading} label="자료 파일을 끌어 놓으면 자동 정리" />}
      {importPanel && <div className="materials-import-panel">{importPanel}</div>}
      <div className="materials-collection-switch subject-collections" role="group" aria-label="과목 필터">
        {[["","전체 자료"],...allSubjects.map(value=>[value,value]),["unclassified","미분류"]].map(([value,label]) => <button key={value} aria-pressed={subject===value} className={subject===value?'active':''} onClick={()=>setSubject(value)}><span>{label}</span><strong>{value ? materials.filter(item=>value==='unclassified' ? !classified.get(item.id)!.subjects.length : classified.get(item.id)!.subjects.includes(value)).length : materials.length}</strong></button>)}
      </div>
      <div className="library-quick-filters" role="group" aria-label="자료 빠른 필터">
        {[["all", "모든 자료", materials.length], ["favorites", "즐겨찾기", materials.filter(item=>item.favorite).length], ["linked", "파일 연결됨", materials.filter(item=>fileUrl(item.fileUrl)).length], ["missing", "링크 미등록", materials.filter(item=>!fileUrl(item.fileUrl)).length]].map(([value,label,count]) => <button key={value} aria-pressed={quick===value} onClick={()=>setQuick(String(value))}>{value === "favorites" && <Star size={14}/>}<span>{label}</span><strong>{count}</strong></button>)}
      </div>
      {favorites.error && <p role="alert" className="alert error">{displayLabel(favorites.error)}</p>}
      <div className="materials-toolbar">
        <label className="materials-search"><Search size={17} /><input aria-label={`${materialLabel} 검색`} value={query} onChange={event => setQuery(event.target.value)} placeholder={classroom ? "제목, 제작자, 수업, 활동 내용 검색" : "제목, 제작자, 행사, 내용 검색"} />{query && <button className="icon-button" aria-label="자료 검색어 지우기" onClick={() => setQuery("")}><X size={14} /></button>}</label>
        <div className="materials-select-filters"><SlidersHorizontal size={15} aria-hidden="true" />
          <select aria-label="기초훈련 필터" value={training} onChange={event=>setTraining(event.target.value)}><option value="">모든 기초훈련</option>{materialTrainings.map(value=><option key={value}>{value}</option>)}</select>
          <select aria-label="자료 대상 필터" value={audience} onChange={event => setAudience(event.target.value)}><option value="">모든 대상</option>{allAudiences.map(value => <option key={value} value={value}>{displayLabel(value)}</option>)}</select>
          <select aria-label="자료 형식 필터" value={format} onChange={event => setFormat(event.target.value)}><option value="">모든 형식</option>{formats.map(value => <option key={value}>{value}</option>)}</select>
          <select aria-label="자료 태그 필터" value={tag} onChange={event => setTag(event.target.value)}><option value="">모든 태그</option>{allTags.map(value => <option key={value} value={value}>{displayLabel(value)}</option>)}</select>
        </div>
      </div>
      <div className="materials-results-header"><p aria-live="polite">{hasFilters ? "찾은 자료" : "전체 자료"} <strong>{filtered.length}</strong>개{hasFilters && <button className="text-button" onClick={resetFilters}>필터 초기화 <X size={12} /></button>}</p><div className="library-result-controls"><label><ArrowDownAZ size={14} /><select aria-label={`${materialLabel} 정렬`} value={sort} onChange={event => setSort(event.target.value)}><option value="recent">최근 수정순</option><option value="date">자료 날짜순</option><option value="title">제목순</option></select></label><ViewSwitch view={view} onChange={setView}/></div></div>
      {filtered.length ? (
        <div className={`materials-grid library-${view}`}>
          {filtered.map(item => <article className="material-card" data-format={item.format} key={item.id}>
            <FavoriteButton item={item} pending={favorites.pending} onToggle={favorites.toggle}/>
            <button type="button" className="material-card-open" onClick={() => setSelectedId(item.id)} aria-label={`${displayLabel(item.title)} 상세보기`}>
            <div className="material-cover" aria-hidden="true"><span className="cover-type">{item.format}</span><FormatIcon format={item.format} size={42}/><span className="cover-caption">{classified.get(item.id)!.subjects.slice(0,2).join(" / ") || (classroom ? "학급 자료" : "강의 자료")}</span><i/><i/></div>
            <div className="material-card-body">
            <div className="material-card-top"><span className="material-subject-badge">{classified.get(item.id)!.subjects.join(", ") || "미분류"}</span><span className={`material-file-status ${fileUrl(item.fileUrl)?"connected":""}`}><Link2 size={12}/>{fileUrl(item.fileUrl)?"파일 연결됨":"링크 미등록"}</span></div>
            <span className="material-format-label">{item.format}{item.date && <span>{dateLabel(item.date)}</span>}</span>
            <h3>{displayLabel(item.title)}</h3>
            <p className="material-card-summary">{displayLabel(item.summary)}</p>
            <div className="material-card-context">{item.author && <p><Users size={12} /><span>{displayLabel(item.author)}</span></p>}{item.eventName && <p><GraduationCap size={12} /><span>{displayLabel(item.eventName)}</span></p>}</div>
            <div className="material-training-labels">{classified.get(item.id)!.trainings.map(value=><span key={value}>{value}</span>)}</div><div className="material-card-footer"><div>{item.audience.length > 0 ? <span>{item.audience.map(displayLabel).join(", ")}</span> : <span className="material-unspecified">대상 미지정</span>}{item.tags.length > 0 && <span className="material-card-tags">{item.tags.slice(0, 3).map(value => `#${displayLabel(value)}`).join(" ")}{item.tags.length > 3 ? ` +${item.tags.length - 3}` : ""}</span>}</div><ArrowUpRight size={17} /></div>
            </div></button><div className="library-card-actions">{fileUrl(item.fileUrl) && <a href={fileUrl(item.fileUrl)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`${displayLabel(item.title)} 원본 열기`}><ExternalLink size={13}/>원본 열기</a>}<button onClick={()=>setEditing(item)} aria-label={`${displayLabel(item.title)} 수정`}><PencilLine size={13}/>수정</button></div>
          </article>)}
        </div>
      ) : (
        <div className="materials-empty"><span><Presentation size={31} /></span><h3>{materials.length ? "조건에 맞는 자료가 없어요" : "등록된 자료가 없습니다"}</h3><button className="button secondary" onClick={materials.length ? resetFilters : () => setEditing(newMaterial(purpose))}>{materials.length ? <X size={15} /> : <Plus size={15} />}{materials.length ? "필터 초기화" : "첫 자료 추가하기"}</button></div>
      )}


      {selected && !editing && !deleting && (
        <Modal title={displayLabel(selected.title)} subtitle={materialClassification(selected).subjects.join(", ")} wide onClose={() => setSelectedId("")}>
          <div className="modal-body material-detail">
            <div className="material-detail-feature"><span className={`material-format-icon format-${formats.indexOf(selected.format)}`}><FormatIcon format={selected.format} size={29} /></span><div><strong>{selected.format} 자료</strong><span>{selected.date ? dateLabel(selected.date) : "자료 날짜 미지정"}</span></div>{fileUrl(selected.fileUrl) ? <a className="button primary" href={fileUrl(selected.fileUrl)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={15} />드라이브에서 열기</a> : <span className="material-no-file">파일 링크 미등록</span>}</div>
            {selected.format === "HTML" && selected.sourceFile && fileUrl(selected.fileUrl) && loadHtmlPreview && <HtmlPreview key={`${selected.id}-${selected.updatedAt}`} item={selected} load={loadHtmlPreview}/>}
            <dl className="material-detail-meta"><div><dt><Users size={14} />제작자 또는 출처</dt><dd>{displayLabel(selected.author) || "미등록"}</dd></div><div><dt><GraduationCap size={14} />{classroom ? "수업 또는 활동" : "행사 또는 강의"}</dt><dd>{displayLabel(selected.eventName) || "미등록"}</dd></div><div><dt><Users size={14} />대상</dt><dd>{selected.audience.map(displayLabel).join(", ") || "미지정"}</dd></div><div><dt><CalendarDays size={14} />자료 날짜</dt><dd>{selected.date ? dateLabel(selected.date) : "미지정"}</dd></div></dl>
            <section className="material-detail-notes"><h3><FileText size={16} />핵심 내용과 활용 메모</h3><p>{displayLabel(selected.summary)}</p></section>
            <div className="material-training-labels">{materialClassification(selected).trainings.map(value=><span key={value}>{value}</span>)}</div>
            {selected.tags.length > 0 && <div className="material-detail-tags">{selected.tags.map(value => <button key={value} onClick={() => { setTag(value); setSelectedId(""); }}>#{displayLabel(value)}</button>)}</div>}

            <section className="material-detail-links"><RelatedLinks workspace={workspace} careers={careers} currentRef={`material:${selected.id}`} onOpen={ref => { setSelectedId(""); onOpen(ref); }} /></section>
          </div>
          <div className="modal-footer material-detail-actions"><button className="text-button material-delete" onClick={() => { setDeleting(selected); setDeleteRevision(workspace.revision); setDeleteError(""); }}><Trash2 size={14} />삭제</button><button className="button secondary" onClick={() => setSelectedId("")}>닫기</button><button className="button primary" onClick={() => setEditing(selected)}><PencilLine size={15} />수정하기</button></div>
        </Modal>
      )}
      {editing && <MaterialEditor key={editing.id || "new-material"} item={editing} workspace={workspace} careers={careers} onSave={onSave} onError={onError} onClose={() => setEditing(null)} />}
      {deleting && <Modal title={`${materialLabel}를 삭제할까요?`} subtitle={displayLabel(deleting.title)} onClose={() => !deleteBusyRef.current && setDeleting(null)}><div className="modal-body"><p className="confirm-description">이 자료의 기록과 다른 항목과의 연결을 삭제합니다. 구글 드라이브 원본 파일은 유지됩니다.</p>{deleteError && <div className="alert error" role="alert">{displayLabel(deleteError)}<p>다른 곳에서 기록이 바뀌었다면 취소한 뒤 최신 내용을 확인해 주세요.</p></div>}</div><div className="modal-footer"><button className="button secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>취소</button><button className="button danger" disabled={deleteBusy} onClick={() => void remove()}>{deleteBusy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{deleteBusy ? "삭제 중" : "자료 삭제"}</button></div></Modal>}
    </div>
  );
}
