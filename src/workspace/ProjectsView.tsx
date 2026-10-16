import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, BookOpen, CalendarDays, Check, FileText, ChevronRight, Image, Layers3, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import { Modal } from "../CareerEditor";
import { displayLabel, LinkPicker, linkedRefs, RelatedLinks, TagsInput } from "./WorkspaceUI";
import type { WorkspaceItem, WorkspaceSectionProps } from "./types";
import FileDropzone from "../FileDropzone";
import { FavoriteButton, useFavorites, useLibraryView, ViewSwitch } from "./LibraryControls";
import MaterialsView from "./MaterialsView";
import "./ProjectsView.css";

type Project = Extract<WorkspaceItem, { kind: "project" }>;
type ResourceLink = { label: string; url: string };
const text = (value: string) => displayLabel(value);

function newProject(): Project {
  return { id: "", kind: "project", title: "", tags: [], createdAt: "", updatedAt: "", schoolYear: "", grade: "", startDate: "", endDate: "", subjects: [], drivingQuestion: "", lessonFlow: "", activities: "", tools: [], outputs: [], photos: [], reflection: "" };
}
function cloneProject(project: Project): Project {
  return { ...project, tags: [...project.tags], tools: [...project.tools], subjects: project.subjects.map(pair => ({ ...pair })), outputs: project.outputs.map(pair => ({ ...pair })), photos: project.photos.map(pair => ({ ...pair })) };
}
function webUrl(value: string, httpsOnly = false) {
  try {
    const parsed = new URL(value.trim());
    if (parsed.username || parsed.password || (httpsOnly ? parsed.protocol !== "https:" : !["http:", "https:"].includes(parsed.protocol))) return "";
    return parsed.href;
  } catch { return ""; }
}
function validDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function period(project: Project) {
  if (project.startDate && project.endDate && project.startDate !== project.endDate) return `${project.startDate} ~ ${project.endDate}`;
  return project.startDate || project.endDate || "기간 미지정";
}
function TextSection({ title, value }: { title: string; value: string }) {
  return value ? <section className="project-text-section"><h3>{title}</h3><p>{text(value)}</p></section> : null;
}

function ResourceFields({ title, value, onChange, photos = false }: { title: string; value: ResourceLink[]; onChange: (links: ResourceLink[]) => void; photos?: boolean }) {
  const update = (index: number, key: keyof ResourceLink, next: string) => onChange(value.map((pair, i) => i === index ? { ...pair, [key]: next } : pair));
  return <section className="project-form-section">
    <div className="project-form-heading"><h3>{title}</h3><button type="button" className="button text-button" onClick={() => onChange([...value, { label: "", url: "" }])} disabled={value.length >= (photos ? 100 : 50)}><Plus size={15} />{photos ? "사진 링크 추가" : "결과물 추가"}</button></div>
    <p className="field-hint">{photos ? "직접 관리하는 사진의 HTTPS 링크를 남겨주세요. 사진 원본은 연결한 서비스에서 보관합니다." : "수업 결과물이나 공유 문서의 제목과 웹 주소를 함께 남겨주세요."}</p>
    {value.map((pair, index) => <div className="project-pair-row" key={index}>
      <label className="field"><span>{photos ? "사진" : "결과물"} 제목 {index + 1}</span><input maxLength={300} value={pair.label} onChange={event => update(index, "label", event.target.value)} placeholder={photos ? "예: 학생 협업 장면" : "예: 우리 반 결과물 모음"} /></label>
      <label className="field"><span>{photos ? "사진" : "결과물"} 주소 {index + 1}</span><input type="url" maxLength={2000} value={pair.url} onChange={event => update(index, "url", event.target.value)} placeholder={photos ? "https://…" : "https://drive.google.com/…"} /></label>
      <button type="button" className="icon-button project-row-remove" aria-label={`${photos ? "사진" : "결과물"} ${index + 1} 삭제`} onClick={() => onChange(value.filter((_, i) => i !== index))}><X size={17} /></button>
    </div>)}
  </section>;
}

function ProjectEditor({ project, workspace, careers, onSave, onClose, onError }: Pick<WorkspaceSectionProps, "workspace" | "careers" | "onSave" | "onError"> & { project: Project; onClose: () => void }) {
  const [draft, setDraft] = useState(() => cloneProject(project));
  const [baseRevision] = useState(workspace.revision);
  const [links, setLinks] = useState(() => project.id ? linkedRefs(workspace, `project:${project.id}`) : []);
  const [toolsInput, setToolsInput] = useState(project.tools.join(", "));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const change = <K extends keyof Project>(key: K, value: Project[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    let validation = "";
    if (!draft.title.trim()) validation = "수업 제목을 입력해 주세요.";
    else if (draft.schoolYear.trim() && !/^\d{4}$/.test(draft.schoolYear.trim())) validation = "학년도는 네 자리 연도로 입력해 주세요. 예: 2026";
    else if (!validDate(draft.startDate) || !validDate(draft.endDate)) validation = "시작일과 종료일을 실제 날짜로 입력해 주세요.";
    else if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) validation = "종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요.";
    else if (draft.subjects.some(pair => pair.unit.trim() && !pair.subject.trim())) validation = "단원에 해당하는 교과를 함께 입력해 주세요.";
    else if (draft.outputs.some(pair => (pair.label.trim() || pair.url.trim()) && (!pair.label.trim() || !webUrl(pair.url)))) validation = "결과물마다 제목과 http:// 또는 https://로 시작하는 주소를 입력해 주세요.";
    else if (draft.photos.some(pair => (pair.label.trim() || pair.url.trim()) && (!pair.label.trim() || !webUrl(pair.url, true)))) validation = "사진마다 제목과 https://로 시작하는 주소를 입력해 주세요.";
    if (validation) { setError(validation); return; }
    const tools = [...new Set(toolsInput.split(/[,\n]/).map(tool => tool.trim()).filter(Boolean))];
    if (tools.length > 50 || tools.some(tool => tool.length > 100)) { setError("활용 도구는 50개까지, 이름은 100자까지 입력할 수 있어요."); return; }
    if (draft.tags.length > 30 || draft.tags.some(value => value.length > 60)) { setError("태그는 30개까지, 각 60자까지 입력할 수 있어요."); return; }
    const prepared: Project = {
      ...draft, title: draft.title.trim(), schoolYear: draft.schoolYear.trim(), grade: draft.grade.trim(),
      subjects: draft.subjects.filter(pair => pair.subject.trim() || pair.unit.trim()).map(pair => ({ subject: pair.subject.trim(), unit: pair.unit.trim() })),
      tools,
      outputs: draft.outputs.filter(pair => pair.label.trim() || pair.url.trim()).map(pair => ({ label: pair.label.trim(), url: webUrl(pair.url) })),
      photos: draft.photos.filter(pair => pair.label.trim() || pair.url.trim()).map(pair => ({ label: pair.label.trim(), url: webUrl(pair.url, true) })),
    };
    setError(""); setBusy(true);
    try { await onSave(prepared, links, baseRevision); onClose(); }
    catch (reason) { setError("저장하지 못했습니다. 입력한 내용은 유지됩니다. 다른 곳에서 기록이 바뀌었다면 내용을 따로 복사한 뒤 닫고, 최신 기록을 다시 열어 수정해 주세요."); onError(reason); }
    finally { setBusy(false); }
  }
  return <Modal title={project.id ? "수업 수정" : "새 수업 기록"} onClose={() => !busy && onClose()} wide>
    <form onSubmit={submit}>
      <div className="modal-body project-editor">
        {error && <div className="alert error" role="alert">{error}</div>}
        <fieldset disabled={busy} className="project-editor-fields">
          <label className="field"><span>수업 제목 <b>*</b></span><input required maxLength={300} value={draft.title} onChange={event => change("title", event.target.value)} placeholder="예: 우리 동네를 바꾸는 작은 실천" /></label>
          <div className="field-grid">
            <label className="field"><span>학년도</span><input inputMode="numeric" maxLength={4} value={draft.schoolYear} onChange={event => change("schoolYear", event.target.value)} placeholder="예: 2026" /></label>
            <label className="field"><span>학년</span><input maxLength={100} value={draft.grade} onChange={event => change("grade", event.target.value)} placeholder="예: 초등 4학년" /></label>
          </div>
          <div className="field-grid">
            <label className="field"><span>시작일</span><input type="date" value={draft.startDate} onChange={event => change("startDate", event.target.value)} /></label>
            <label className="field"><span>종료일</span><input type="date" value={draft.endDate} onChange={event => change("endDate", event.target.value)} /></label>
          </div>
          <section className="project-form-section">
            <div className="project-form-heading"><h3>연계 교과와 단원</h3><button type="button" className="button text-button" disabled={draft.subjects.length >= 100} onClick={() => change("subjects", [...draft.subjects, { subject: "", unit: "" }])}><Plus size={15} />교과 추가</button></div>
            {!draft.subjects.length && <p className="field-hint">여러 교과를 연결한 수업도 교과별로 기록할 수 있어요.</p>}
            {draft.subjects.map((pair, index) => <div className="project-pair-row" key={index}>
              <label className="field"><span>교과 {index + 1}</span><input maxLength={300} value={pair.subject} onChange={event => change("subjects", draft.subjects.map((item, i) => i === index ? { ...item, subject: event.target.value } : item))} placeholder="예: 사회" /></label>
              <label className="field"><span>단원 {index + 1}</span><input maxLength={300} value={pair.unit} onChange={event => change("subjects", draft.subjects.map((item, i) => i === index ? { ...item, unit: event.target.value } : item))} placeholder="예: 지역의 공공 기관" /></label>
              <button type="button" className="icon-button project-row-remove" aria-label={`교과 ${index + 1} 삭제`} onClick={() => change("subjects", draft.subjects.filter((_, i) => i !== index))}><X size={17} /></button>
            </div>)}
          </section>
          <details className="optional-fields"><summary>수업 흐름, 활동과 결과물</summary>
          <label className="field"><span>핵심 질문</span><textarea rows={2} maxLength={2000} value={draft.drivingQuestion} onChange={event => change("drivingQuestion", event.target.value)} placeholder="학생들과 함께 탐구할 질문은 무엇인가요?" /></label>
          <label className="field"><span>수업 흐름</span><textarea rows={4} maxLength={20000} value={draft.lessonFlow} onChange={event => change("lessonFlow", event.target.value)} placeholder="문제 발견 → 탐구 → 만들기 → 나눔처럼 수업의 흐름을 적어주세요." /></label>
          <label className="field"><span>주요 활동</span><textarea rows={4} maxLength={20000} value={draft.activities} onChange={event => change("activities", event.target.value)} placeholder="학생들이 실제로 한 활동과 기억에 남는 순간을 남겨주세요." /></label>
          <label className="field"><span>활용 도구</span><input maxLength={6000} value={toolsInput} onChange={event => setToolsInput(event.target.value)} placeholder="예: 패들렛, 캔바, 구글 설문지" /><small>쉼표로 구분해 입력해 주세요.</small></label>
          <ResourceFields title="수업 결과물" value={draft.outputs} onChange={value => change("outputs", value)} />
          <ResourceFields title="활동 사진" value={draft.photos} onChange={value => change("photos", value)} photos />
          <label className="field"><span>수업 성찰</span><textarea rows={4} maxLength={20000} value={draft.reflection} onChange={event => change("reflection", event.target.value)} placeholder="잘된 점, 아쉬운 점, 다음 수업에 이어가고 싶은 것을 기록해 주세요." /></label>
          <div className="field"><TagsInput value={draft.tags} onChange={value => change("tags", value)} /></div>
          <section className="project-form-section"><h3>함께 연결할 기록</h3><LinkPicker workspace={workspace} careers={careers} currentRef={project.id ? `project:${project.id}` : undefined} value={links} onChange={setLinks} /></section>
          </details>
        </fieldset>
      </div>
      <div className="modal-footer"><div className="footer-buttons"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>취소</button><button type="submit" className="button primary" disabled={busy}><Check size={17} />{busy ? "저장 중" : "수업 저장"}</button></div></div>
    </form>
  </Modal>;
}

function PhotoLink({ photo }: { photo: ResourceLink }) {
  const [preview, setPreview] = useState(false);
  const [failed, setFailed] = useState(false);
  const href = webUrl(photo.url, true);
  return <article className="project-photo-card">
    {preview && href && !failed ? <img src={href} alt={text(photo.label)} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <div className="project-photo-placeholder"><Image size={25} /><span>{failed ? "이 주소는 미리보기를 지원하지 않아요." : "활동 사진"}</span></div>}
    <div className="project-photo-caption"><strong>{text(photo.label)}</strong>{href ? <div><a href={href} target="_blank" rel="noopener noreferrer" className="project-inline-link">원본 보기<ArrowUpRight size={15} /></a>{!preview && <button type="button" className="button text-button" onClick={() => setPreview(true)}>사진 미리보기</button>}</div> : <span className="field-hint">링크 확인 필요</span>}</div>
  </article>;
}

function ProjectRecordsView({ workspace, careers, onSave, onDelete, onOpen, focusId, onError }: WorkspaceSectionProps) {
  const projects = useMemo(() => workspace.items.filter((item): item is Project => item.kind === "project"), [workspace.items]);
  const [view, setView] = useLibraryView("projects");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const favorites = useFavorites({ workspace, onSave, onError });
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [subject, setSubject] = useState("");
  const [tag, setTag] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deleteRevision, setDeleteRevision] = useState(workspace.revision);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  useEffect(() => { if (focusId && projects.some(project => project.id === focusId)) setSelectedId(focusId); }, [focusId, projects]);
  const years = [...new Set(projects.map(project => project.schoolYear).filter(Boolean))].sort().reverse();
  const subjects = [...new Set(projects.flatMap(project => project.subjects.map(pair => pair.subject)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const tags = [...new Set(projects.flatMap(project => project.tags))].sort((a, b) => a.localeCompare(b, "ko"));
  const tokens = text(query).normalize("NFC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = projects.filter(project => {
    const haystack = text([project.title, project.schoolYear, project.grade, project.drivingQuestion, project.lessonFlow, project.activities, project.reflection, ...project.tags, ...project.tools, ...project.subjects.flatMap(pair => [pair.subject, pair.unit])].join(" ")).normalize("NFC").toLocaleLowerCase();
    return (!onlyFavorites || project.favorite) && (!year || project.schoolYear === year) && (!subject || project.subjects.some(pair => pair.subject === subject)) && (!tag || project.tags.includes(tag)) && tokens.every(token => haystack.includes(token));
  }).sort((a, b) => (b.startDate || b.schoolYear || b.updatedAt).localeCompare(a.startDate || a.schoolYear || a.updatedAt) || a.title.localeCompare(b.title, "ko"));
  const selected = projects.find(project => project.id === selectedId);
  const filteredActive = Boolean(query || year || subject || tag || onlyFavorites);
  async function removeProject() {
    if (!deleting || busy) return;
    setBusy(true); setDeleteError("");
    try { await onDelete(deleting.id, deleteRevision); setDeleting(null); setSelectedId(undefined); }
    catch (reason) { setDeleteError("삭제하지 못했습니다. 다른 곳에서 기록이 바뀌었다면 이 창을 닫고 최신 기록을 다시 확인해 주세요."); onError(reason); }
    finally { setBusy(false); }
  }
  return <section className="projects-view">
    <header className="projects-heading"><div><span className="library-kicker">CLASSROOM PORTFOLIO</span><h1>수업 기록<span className="library-total" aria-hidden="true">{projects.length}</span></h1></div><button className="button primary" onClick={() => setEditing(newProject())}><Plus size={17} />수업 추가</button></header>
    <div className="projects-summary"><span><Layers3 size={18} /><strong>{projects.length}</strong>개 수업</span><span>{subjects.length}개 교과</span></div>
    <div className="library-quick-filters" role="group" aria-label="수업 빠른 필터"><button aria-pressed={!onlyFavorites} onClick={()=>setOnlyFavorites(false)}>전체 수업 <strong>{projects.length}</strong></button><button aria-pressed={onlyFavorites} onClick={()=>setOnlyFavorites(!onlyFavorites)}><Star size={14}/>즐겨찾기 <strong>{projects.filter(item=>item.favorite).length}</strong></button></div>
    {favorites.error && <p role="alert" className="alert error">{text(favorites.error)}</p>}
    <div className="project-filters panel"><label className="project-search"><Search size={17} /><input aria-label="수업 검색" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="제목, 교과, 활동, 태그 검색" /></label><label className="project-filter-select"><span>학년도</span><select aria-label="학년도 필터" value={year} onChange={event => setYear(event.target.value)}><option value="">전체 학년도</option>{years.map(value => <option key={value} value={value}>{text(value)}학년도</option>)}</select></label><label className="project-filter-select"><span>교과</span><select aria-label="교과 필터" value={subject} onChange={event => setSubject(event.target.value)}><option value="">전체 교과</option>{subjects.map(value => <option key={value} value={value}>{text(value)}</option>)}</select></label><label className="project-filter-select"><span>태그</span><select aria-label="태그 필터" value={tag} onChange={event => setTag(event.target.value)}><option value="">전체 태그</option>{tags.map(value => <option key={value} value={value}>{text(value)}</option>)}</select></label></div>
    <div className="projects-result-line"><span aria-live="polite">{filtered.length}개의 수업{filteredActive && ` / 전체 ${projects.length}개`}</span>{filteredActive && <button type="button" className="button text-button" onClick={() => { setOnlyFavorites(false); setQuery(""); setYear(""); setSubject(""); setTag(""); }}>필터 초기화</button>}<ViewSwitch view={view} onChange={setView}/></div>
    {filtered.length ? <div className={`project-grid library-${view}`}>{filtered.map(project => <article className="project-card" key={project.id}>
      <FavoriteButton item={project} pending={favorites.pending} onToggle={favorites.toggle}/>
      <button type="button" className="project-card-open" onClick={() => setSelectedId(project.id)} aria-label={`${text(project.title)} 자세히 보기`}>
      <div className="project-cover" aria-hidden="true"><span>{text(project.schoolYear) || "CLASS"}</span><BookOpen size={34}/><small>{[...new Set(project.subjects.map(pair=>text(pair.subject)))].slice(0,3).join(" / ") || "수업 기록"}</small></div><div className="project-card-body">
      <div className="project-card-top"><span className="project-card-year">{project.schoolYear ? `${text(project.schoolYear)}학년도` : "수업 기록"}</span><ChevronRight size={18} /></div>
      <h2>{text(project.title)}</h2><p className="project-card-question">{text(project.drivingQuestion || project.activities)}</p>
      <div className="project-card-subjects">{project.grade && <span>{text(project.grade)}</span>}{[...new Set(project.subjects.map(pair => pair.subject))].map(value => <span key={value}>{text(value)}</span>)}</div>
      <div className="project-card-date"><CalendarDays size={14} /><span>{text(period(project))}</span></div>
      {!!project.tags.length && <div className="project-card-tags">{project.tags.slice(0, 4).map(value => <span key={value}>#{text(value)}</span>)}{project.tags.length > 4 && <span>+{project.tags.length - 4}</span>}</div>}
      <div className="project-card-bottom"><span>결과물 {project.outputs.length}개</span><span>사진 {project.photos.length}개</span><span>연결 {linkedRefs(workspace, `project:${project.id}`).length}개</span></div>
    </div></button></article>)}</div> : <div className="panel project-empty"><BookOpen size={35} /><h2>{projects.length ? "조건에 맞는 수업이 없어요" : "등록된 수업이 없습니다"}</h2>{!projects.length && <button className="button primary" onClick={() => setEditing(newProject())}><Plus size={17} />첫 수업 기록하기</button>}</div>}
    {selected && !editing && !deleting && <Modal title={text(selected.title)} subtitle={[selected.schoolYear && `${text(selected.schoolYear)}학년도`, selected.grade && text(selected.grade)].filter(Boolean).join(" / ")} onClose={() => setSelectedId(undefined)} wide>
      <div className="modal-body project-detail">
        <div className="project-detail-meta"><span><CalendarDays size={16} />{text(period(selected))}</span><button type="button" className="button secondary" onClick={() => setEditing(cloneProject(selected))}><Pencil size={15} />수정</button></div>
        {selected.drivingQuestion && <section className="project-driving-question"><span>이 수업을 여는 질문</span><p>{text(selected.drivingQuestion)}</p></section>}
        {!!selected.subjects.length && <section className="project-text-section"><h3>연계 교과와 단원</h3><dl className="project-subject-detail">{selected.subjects.map((pair, index) => <div key={index}><dt>{text(pair.subject)}</dt><dd>{text(pair.unit || "단원 미지정")}</dd></div>)}</dl></section>}
        <TextSection title="수업 흐름" value={selected.lessonFlow} /><TextSection title="주요 활동" value={selected.activities} />
        {!!selected.tools.length && <section className="project-text-section"><h3>활용 도구</h3><div className="tags">{selected.tools.map(value => <span key={value}>{text(value)}</span>)}</div></section>}
        {!!selected.outputs.length && <section className="project-text-section"><h3>수업 결과물</h3><div className="project-output-list">{selected.outputs.map((link, index) => { const href = webUrl(link.url); return href ? <a href={href} key={index} target="_blank" rel="noopener noreferrer"><span>{text(link.label)}</span><ArrowUpRight size={17} /></a> : <div key={index}>{text(link.label)} <small>링크 확인 필요</small></div>; })}</div></section>}
        {!!selected.photos.length && <section className="project-text-section"><h3>활동 사진</h3><div className="project-photo-grid">{selected.photos.map((photo, index) => <PhotoLink key={`${photo.url}-${index}`} photo={photo} />)}</div></section>}
        <TextSection title="수업 성찰" value={selected.reflection} />
        {!!selected.tags.length && <div className="tags">{selected.tags.map(value => <span key={value}>#{text(value)}</span>)}</div>}
        <section className="project-text-section"><RelatedLinks workspace={workspace} careers={careers} currentRef={`project:${selected.id}`} onOpen={ref => { setSelectedId(undefined); onOpen(ref); }} /></section>
      </div>
      <div className="modal-footer"><button type="button" className="button text-button project-delete-button" onClick={() => { setDeleteError(""); setDeleteRevision(workspace.revision); setDeleting(selected); }}><Trash2 size={16} />수업 삭제</button><div className="footer-buttons"><button className="button secondary" onClick={() => setSelectedId(undefined)}>닫기</button></div></div>
    </Modal>}
    {editing && <ProjectEditor key={editing.id || "new"} project={editing} workspace={workspace} careers={careers} onSave={onSave} onError={onError} onClose={() => setEditing(null)} />}
    {deleting && <Modal title="수업을 삭제할까요?" onClose={() => !busy && setDeleting(null)}><div className="modal-body"><p className="project-delete-copy">‘{text(deleting.title)}’ 기록과 다른 기록으로 연결된 관계를 삭제합니다. 연결한 경력과 자료, 외부에 보관한 결과물과 사진은 그대로 남아요.</p>{deleteError && <div className="alert error" role="alert">{deleteError}</div>}</div><div className="modal-footer"><div className="footer-buttons"><button className="button secondary" disabled={busy} onClick={() => setDeleting(null)}>취소</button><button className="button primary" disabled={busy} onClick={removeProject}>{busy ? "삭제 중" : "수업 삭제"}</button></div></div></Modal>}
  </section>;
}

export interface ProjectsViewProps extends WorkspaceSectionProps {
  classroomImport?: ReactNode;
}

export default function ProjectsView({ classroomImport, ...props }: ProjectsViewProps) {
  const focused = props.workspace.items.find(item => item.id === props.focusId);
  const focusedSection = focused?.kind === "material" && focused.purpose === "classroom" ? "classroom"
    : focused?.kind === "project" ? "records" : undefined;
  const [section, setSection] = useState<"records" | "classroom">(() => focusedSection ?? (props.initialSection === "classroom" ? "classroom" : "records"));
  useEffect(() => { if (focusedSection) setSection(focusedSection); }, [props.focusId, focusedSection]);
  const recordCount = props.workspace.items.filter(item => item.kind === "project").length;
  const materialCount = props.workspace.items.filter(item => item.kind === "material" && item.purpose === "classroom").length;
  return <div className="classroom-view">
    {section === "records" && props.onFiles && <FileDropzone onFiles={files=>props.onFiles!(files,"classroom")} busy={props.uploading} label="수업 자료를 끌어 놓으면 자동 정리" />}
    <div className="classroom-sections" role="tablist" aria-label="수업 분류" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "records" : event.key === "End" ? "classroom" : section === "records" ? "classroom" : "records";
      setSection(next);
      event.currentTarget.querySelector<HTMLButtonElement>(next === "records" ? "#classroom-records-tab" : "#classroom-materials-tab")?.focus();
    }}>
      <button id="classroom-records-tab" type="button" role="tab" tabIndex={section === "records" ? 0 : -1} aria-selected={section === "records"} aria-controls="classroom-content" onClick={() => setSection("records")}><BookOpen size={17} /><span>수업 기록</span><strong>{recordCount}</strong></button>
      <button id="classroom-materials-tab" type="button" role="tab" tabIndex={section === "classroom" ? 0 : -1} aria-selected={section === "classroom"} aria-controls="classroom-content" onClick={() => setSection("classroom")}><FileText size={17} /><span>학급 자료</span><strong>{materialCount}</strong></button>
    </div>
    <div id="classroom-content" role="tabpanel" aria-labelledby={section === "records" ? "classroom-records-tab" : "classroom-materials-tab"}>
      {section === "records" ? <ProjectRecordsView {...props} /> : <MaterialsView {...props} purpose="classroom" importPanel={classroomImport} />}
    </div>
  </div>;
}
