import { cloneElement, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { ArrowUpRight, BookOpen, CalendarDays, Check, GraduationCap, Lightbulb, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Modal } from "../CareerEditor";
import { LinkPicker, RelatedLinks, TagsInput, displayLabel, linkedRefs } from "./WorkspaceUI";
import type { WorkspaceItem, WorkspaceSectionProps } from "./types";
import "./GraduateView.css";

type GraduateKind = "course" | "assignment" | "paper" | "idea";
type GraduateItem = Extract<WorkspaceItem, { kind: GraduateKind }>;
type Course = Extract<WorkspaceItem, { kind: "course" }>;
type Assignment = Extract<WorkspaceItem, { kind: "assignment" }>;
type Paper = Extract<WorkspaceItem, { kind: "paper" }>;
type Idea = Extract<WorkspaceItem, { kind: "idea" }>;
const sections: { kind: GraduateKind; name: string; hint: string; icon: typeof BookOpen }[] = [
  { kind: "course", name: "강좌", hint: "학기마다 쌓이는 배움을 정리해 보세요.", icon: GraduationCap },
  { kind: "assignment", name: "과제", hint: "마감일과 제출물을 한곳에서 챙기세요.", icon: CalendarDays },
  { kind: "paper", name: "논문 노트", hint: "읽은 내용과 내 생각을 함께 남겨 보세요.", icon: BookOpen },
  { kind: "idea", name: "논문 주제 메모", hint: "떠오른 질문이 다음 연구의 시작이 됩니다.", icon: Lightbulb },
];
const statusNames: Record<Assignment["status"], string> = { planned: "예정", "in-progress": "진행 중", submitted: "제출 완료" };
const graduateKinds = new Set<WorkspaceItem["kind"]>(["course", "assignment", "paper", "idea"]);
function isGraduate(item: WorkspaceItem): item is GraduateItem { return graduateKinds.has(item.kind); }
function emptyItem(kind: GraduateKind): GraduateItem {
  const common = { id: "", title: "", tags: [], createdAt: "", updatedAt: "" };
  switch (kind) {
    case "course": return { ...common, kind, semester: "", professor: "" };
    case "assignment": return { ...common, kind, courseId: "", dueDate: "", status: "planned", submissionUrl: "" };
    case "paper": return { ...common, kind, authors: "", year: "", summary: "", thoughts: "", quotations: [], courseIds: [] };
    case "idea": return { ...common, kind, body: "" };
  }
}
function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function dueLabel(item: Assignment) {
  if (!item.dueDate) return "마감일 미정";
  if (item.status === "submitted") return `마감 ${item.dueDate}`;
  const today = todayDate();
  if (item.dueDate < today) return `마감 지남 ${item.dueDate}`;
  if (item.dueDate === today) return "오늘 마감";
  return `마감 ${item.dueDate}`;
}
function externalUrl(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function mutationError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return /기록이 변경|최신 내용|409/.test(message) ? `${message} 이 창을 닫고 최신 기록을 다시 열어 주세요.` : message;
}
function Field({ label, children, wide = false }: { label: string; children: ReactElement<{ "aria-labelledby"?: string }>; wide?: boolean }) {
  const labelId = useId();
  return <label className={`field ${wide ? "grad-field-wide" : ""}`}><span id={labelId}>{label}</span>{cloneElement(children, { "aria-labelledby": labelId })}</label>;
}
function TextSection({ title, text }: { title: string; text: string }) {
  return text ? <section className="grad-text-section"><h3>{title}</h3><p>{displayLabel(text)}</p></section> : null;
}

export default function GraduateView({ workspace, careers, onSave, onDelete, onOpen, focusId, onError }: WorkspaceSectionProps) {
  const lastFocus = useRef("");
  const [kind, setKind] = useState<GraduateKind>("course");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [semester, setSemester] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<GraduateItem | null>(null);
  const [draftRevision, setDraftRevision] = useState(workspace.revision);
  const [deleteRevision, setDeleteRevision] = useState(workspace.revision);
  const [draftLinks, setDraftLinks] = useState<string[]>([]);
  const [deleteItem, setDeleteItem] = useState<GraduateItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const all = workspace.items.filter(isGraduate);
  const courses = workspace.items.filter((item): item is Course => item.kind === "course");
  const courseTitle = (id: string) => courses.find((item) => item.id === id)?.title || "강좌 미지정";
  const selected = all.find((item) => item.id === selectedId);
  const activeSection = sections.find((section) => section.kind === kind)!;
  const tags = [...new Set(all.filter((item) => item.kind === kind).flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b, "ko"));
  const semesters = [...new Set(courses.map((item) => item.semester).filter(Boolean))].sort((a, b) => b.localeCompare(a, "ko"));
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return workspace.items.filter(isGraduate).filter((item) => {
      if (item.kind !== kind || (tag && !item.tags.includes(tag))) return false;
      if (item.kind === "course" && semester && item.semester !== semester) return false;
      if (item.kind === "assignment" && status && item.status !== status) return false;
      const courseIds = item.kind === "assignment" ? [item.courseId] : item.kind === "paper" ? item.courseIds : [];
      const linkedCourseNames = workspace.items.filter((entry) => entry.kind === "course" && courseIds.includes(entry.id)).map((entry) => entry.title);
      const searchable = [item.title, item.tags.join(" "), ...linkedCourseNames,
        item.kind === "course" ? `${item.semester} ${item.professor}` : "",
        item.kind === "assignment" ? `${item.dueDate} ${statusNames[item.status]}` : "",
        item.kind === "paper" ? `${item.authors} ${item.year} ${item.summary} ${item.thoughts} ${item.quotations.map((quote) => `${quote.text} ${quote.page}`).join(" ")}` : "",
        item.kind === "idea" ? item.body : ""].join(" ").toLocaleLowerCase();
      return !needle || searchable.includes(needle);
    }).sort((a, b) => {
      if (a.kind === "assignment" && b.kind === "assignment") return (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.title.localeCompare(b.title, "ko");
      if (a.kind === "course" && b.kind === "course") return b.semester.localeCompare(a.semester, "ko") || a.title.localeCompare(b.title, "ko");
      return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, "ko");
    });
  }, [workspace.items, kind, query, tag, semester, status]);
  useEffect(() => {
    if (!focusId || lastFocus.current === focusId) return;
    const found = workspace.items.find((item) => item.id === focusId && isGraduate(item));
    if (found && isGraduate(found)) { lastFocus.current = focusId; setKind(found.kind); setSelectedId(found.id); setQuery(""); setTag(""); setSemester(""); setStatus(""); }
  }, [focusId, workspace.items]);
  function chooseKind(next: GraduateKind) { setKind(next); setQuery(""); setTag(""); setSemester(""); setStatus(""); }
  function edit(item: GraduateItem) {
    setError(""); setSelectedId(""); setDraft(structuredClone(item)); setDraftRevision(workspace.revision);
    setDraftLinks(item.id ? linkedRefs(workspace, `${item.kind}:${item.id}`) : []);
  }
  function change<K extends keyof GraduateItem>(key: K, value: GraduateItem[K]) { setDraft((item) => item ? { ...item, [key]: value } : item); }
  function patch(values: Partial<Course> | Partial<Assignment> | Partial<Paper> | Partial<Idea>) {
    setDraft((item) => item ? { ...item, ...values } as GraduateItem : item);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    if (!draft.title.trim()) { setError("제목을 입력해 주세요."); return; }
    if (draft.kind === "assignment" && draft.submissionUrl && !externalUrl(draft.submissionUrl)) { setError("제출물 링크는 http 또는 https로 시작하는 주소를 입력해 주세요."); return; }
    setBusy(true); setError("");
    try { await onSave({ ...draft, title: draft.title.trim() }, draftLinks, draftRevision); setDraft(null); }
    catch (err) { setError(mutationError(err, "저장하지 못했습니다. 다시 시도해 주세요.")); onError(err); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleteItem || busy) return;
    setBusy(true); setError("");
    try { await onDelete(deleteItem.id, deleteRevision); setSelectedId(""); setDeleteItem(null); }
    catch (err) { setError(mutationError(err, "삭제하지 못했습니다. 다시 시도해 주세요.")); onError(err); }
    finally { setBusy(false); }
  }
  function openLocal(item: GraduateItem) { setKind(item.kind); setSelectedId(item.id); }
  const count = all.filter((item) => item.kind === kind).length;

  return <section className="graduate-view" aria-label="대학원 기록">
    <header className="grad-heading"><div><span className="grad-eyebrow">STUDY & RESEARCH</span><h1>대학원</h1><p>배움과 생각을 연구의 기록으로.</p></div><button className="button primary" aria-label={`${activeSection.name} 추가`} onClick={() => edit(emptyItem(kind))}><Plus size={17} />{kind === "idea" ? "메모" : activeSection.name} 추가</button></header>
    <div className="grad-tabs" role="tablist" aria-label="대학원 분류">{sections.map(({ kind: sectionKind, name, icon: Icon }) => <button key={sectionKind} id={`grad-tab-${sectionKind}`} role="tab" aria-selected={kind === sectionKind} aria-controls="graduate-records" className={kind === sectionKind ? "active" : ""} onClick={() => chooseKind(sectionKind)}><Icon size={18} /><span>{name}</span><small>{all.filter((item) => item.kind === sectionKind).length}</small></button>)}</div>
    <div id="graduate-records" role="tabpanel" aria-labelledby={`grad-tab-${kind}`}>
      <div className="grad-section-heading"><div><h2>{activeSection.name}<span>{count}</span></h2><p>{activeSection.hint}</p></div>{kind === "assignment" && <span className="grad-sort-hint">마감일 빠른 순, 미정은 마지막</span>}</div>
      <div className="grad-filters"><label className="grad-search"><Search size={18} /><input type="search" aria-label={`${activeSection.name} 검색`} placeholder={kind === "paper" ? "제목, 저자, 내용, 인용문 검색" : "제목, 내용, 태그 검색"} value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label="검색어 지우기" onClick={() => setQuery("")}><X size={15} /></button>}</label>
        {kind === "course" && <select aria-label="학기 필터" value={semester} onChange={(event) => setSemester(event.target.value)}><option value="">모든 학기</option>{semesters.map((value) => <option key={value} value={value}>{displayLabel(value)}</option>)}</select>}
        {kind === "assignment" && <select aria-label="과제 상태 필터" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">모든 상태</option>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
        <select aria-label="대학원 태그 필터" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">모든 태그</option>{tags.map((value) => <option key={value} value={value}>{displayLabel(value)}</option>)}</select>
      </div>
      {!filtered.length ? <div className="grad-empty"><activeSection.icon size={30} /><h3>{count ? "조건에 맞는 기록이 없어요" : `첫 ${activeSection.name} 기록을 남겨 보세요`}</h3><p>{count ? "검색어나 필터를 바꾸면 다른 기록을 찾을 수 있어요." : activeSection.hint}</p>{count ? <button className="button secondary" onClick={() => { setQuery(""); setTag(""); setSemester(""); setStatus(""); }}>필터 초기화</button> : <button className="button primary" onClick={() => edit(emptyItem(kind))}><Plus size={16} />{activeSection.name} 추가</button>}</div> : <div className={`grad-records grad-records-${kind}`}>
        {filtered.map((item) => <article className="grad-card" key={item.id}><button className="grad-card-open" onClick={() => setSelectedId(item.id)} aria-label={`${displayLabel(item.title)} 상세 보기`}>
          <div className="grad-card-top">{item.kind === "course" && <span>{displayLabel(item.semester) || "학기 미지정"}</span>}{item.kind === "assignment" && <><span className={`grad-status ${item.status}`}>{statusNames[item.status]}</span><span className={item.dueDate && item.dueDate <= todayDate() && item.status !== "submitted" ? "grad-due urgent" : "grad-due"}>{dueLabel(item)}</span></>}{item.kind === "paper" && <span>{[item.authors, item.year].filter(Boolean).map(displayLabel).join(", ") || "논문 노트"}</span>}{item.kind === "idea" && <span>주제 메모</span>}</div>
          <h3>{displayLabel(item.title)}</h3>{item.kind === "course" && <p>{item.professor ? `${displayLabel(item.professor)} 교수` : "교수명 미입력"}</p>}{item.kind === "assignment" && <p>{displayLabel(courseTitle(item.courseId))}</p>}{item.kind === "paper" && <p className="grad-excerpt">{displayLabel(item.summary || item.thoughts) || "요약과 생각을 기록해 보세요."}</p>}{item.kind === "idea" && <p className="grad-excerpt">{displayLabel(item.body) || "떠오르는 생각을 자유롭게 적어 보세요."}</p>}
          {!!item.tags.length && <div className="grad-tag-list">{item.tags.slice(0, 4).map((value) => <span key={value}>#{displayLabel(value)}</span>)}{item.tags.length > 4 && <span>+{item.tags.length - 4}</span>}</div>}
        </button><div className="grad-card-actions"><button className="icon-button" aria-label={`${displayLabel(item.title)} 수정`} onClick={() => edit(item)}><Pencil size={16} /></button><button className="icon-button" aria-label={`${displayLabel(item.title)} 삭제`} onClick={() => { setError(""); setDeleteItem(item); setDeleteRevision(workspace.revision); }}><Trash2 size={16} /></button></div></article>)}
      </div>}
    </div>

    {selected && !draft && !deleteItem && <Modal title={displayLabel(selected.title)} subtitle={sections.find((section) => section.kind === selected.kind)?.name} onClose={() => setSelectedId("")} wide><div className="modal-body grad-detail">
      {selected.kind === "course" && <><dl className="grad-facts"><div><dt>학기</dt><dd>{displayLabel(selected.semester) || "미지정"}</dd></div><div><dt>교수명</dt><dd>{displayLabel(selected.professor) || "미입력"}</dd></div></dl><section className="grad-text-section"><h3>이 강좌의 과제와 논문 노트</h3><div className="grad-connected">{all.filter((item) => (item.kind === "assignment" && item.courseId === selected.id) || (item.kind === "paper" && item.courseIds.includes(selected.id))).map((item) => <button key={item.id} className="button secondary" onClick={() => openLocal(item)}>{item.kind === "assignment" ? "과제" : "논문"}: {displayLabel(item.title)}<ArrowUpRight size={14} /></button>)}</div>{!all.some((item) => (item.kind === "assignment" && item.courseId === selected.id) || (item.kind === "paper" && item.courseIds.includes(selected.id))) && <p>아직 이 강좌에 연결된 과제나 논문 노트가 없어요.</p>}</section></>}
      {selected.kind === "assignment" && <><dl className="grad-facts"><div><dt>강좌</dt><dd>{selected.courseId && courses.some((course) => course.id === selected.courseId) ? <button className="grad-text-button" onClick={() => onOpen(`course:${selected.courseId}`)}>{displayLabel(courseTitle(selected.courseId))}<ArrowUpRight size={14} /></button> : "강좌 미지정"}</dd></div><div><dt>마감일</dt><dd>{selected.dueDate || "미정"}</dd></div><div><dt>상태</dt><dd><span className={`grad-status ${selected.status}`}>{statusNames[selected.status]}</span></dd></div></dl>{externalUrl(selected.submissionUrl) && <a className="button secondary grad-external" href={externalUrl(selected.submissionUrl)} target="_blank" rel="noopener noreferrer">제출물 열기<ArrowUpRight size={16} /></a>}</>}
      {selected.kind === "paper" && <><dl className="grad-facts"><div><dt>저자</dt><dd>{displayLabel(selected.authors) || "미입력"}</dd></div><div><dt>연도</dt><dd>{selected.year || "미입력"}</dd></div></dl><TextSection title="핵심 내용 요약" text={selected.summary} /><TextSection title="내 생각" text={selected.thoughts} />{!!selected.quotations.length && <section className="grad-text-section"><h3>인용할 문장</h3>{selected.quotations.map((quote, index) => <blockquote className="grad-quotation" key={index}><p>{displayLabel(quote.text)}</p><cite>{quote.page ? `${displayLabel(quote.page)}쪽` : "쪽수 미입력"}</cite></blockquote>)}</section>}<section className="grad-text-section"><h3>관련 강좌</h3><div className="grad-connected">{selected.courseIds.filter((id) => courses.some((course) => course.id === id)).map((id) => <button key={id} className="button secondary" onClick={() => onOpen(`course:${id}`)}>{displayLabel(courseTitle(id))}<ArrowUpRight size={14} /></button>)}</div>{!selected.courseIds.some((id) => courses.some((course) => course.id === id)) && <p>연결된 강좌가 없어요.</p>}</section></>}
      {selected.kind === "idea" && <TextSection title="아이디어" text={selected.body} />}
      {!!selected.tags.length && <div className="grad-tag-list">{selected.tags.map((value) => <button key={value} onClick={() => { chooseKind(selected.kind); setTag(value); setSelectedId(""); }}>#{displayLabel(value)}</button>)}</div>}
      <RelatedLinks workspace={workspace} careers={careers} currentRef={`${selected.kind}:${selected.id}`} onOpen={onOpen} />
    </div><div className="modal-footer"><button className="button secondary" onClick={() => setSelectedId("")}>닫기</button><button className="button primary" onClick={() => edit(selected)}><Pencil size={16} />수정</button></div></Modal>}

    {draft && <Modal title={`${sections.find((section) => section.kind === draft.kind)?.name} ${draft.id ? "수정" : "추가"}`} subtitle="기록은 다른 이력과 연결해 다시 찾아볼 수 있어요." onClose={() => !busy && setDraft(null)} wide><form onSubmit={save}><fieldset className="grad-fieldset" disabled={busy}><div className="modal-body grad-editor">
      {error && <div className="alert error" role="alert">{error}</div>}
      <Field label={draft.kind === "course" ? "강좌명 *" : draft.kind === "assignment" ? "과제명 *" : "제목 *"}><input required maxLength={300} value={draft.title} onChange={(event) => change("title", event.target.value)} /></Field>
      {draft.kind === "course" && <div className="field-grid"><Field label="학기"><input placeholder="예: 2026년 2학기" maxLength={100} value={draft.semester} onChange={(event) => patch({ semester: event.target.value })} /></Field><Field label="교수명"><input maxLength={200} value={draft.professor} onChange={(event) => patch({ professor: event.target.value })} /></Field></div>}
      {draft.kind === "assignment" && <><Field label="연결 강좌"><select value={draft.courseId} onChange={(event) => patch({ courseId: event.target.value })}><option value="">강좌 미지정</option>{courses.map((course) => <option key={course.id} value={course.id}>{displayLabel(course.title)}{course.semester ? ` (${displayLabel(course.semester)})` : ""}</option>)}</select></Field>{!courses.length && <p className="grad-field-help">강좌를 먼저 추가하면 과제를 강좌별로 모아 볼 수 있어요.</p>}<div className="field-grid"><Field label="마감일"><input type="date" value={draft.dueDate} onChange={(event) => patch({ dueDate: event.target.value })} /></Field><Field label="상태"><select value={draft.status} onChange={(event) => patch({ status: event.target.value as Assignment["status"] })}>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><Field label="제출물 링크"><input type="url" maxLength={2000} placeholder="https://" value={draft.submissionUrl} onChange={(event) => patch({ submissionUrl: event.target.value })} /></Field></>}
      {draft.kind === "paper" && <><div className="field-grid"><Field label="저자"><input maxLength={500} value={draft.authors} onChange={(event) => patch({ authors: event.target.value })} /></Field><Field label="연도"><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="예: 2026" value={draft.year} onChange={(event) => patch({ year: event.target.value })} /></Field></div><Field label="핵심 내용 요약"><textarea rows={5} maxLength={20000} value={draft.summary} onChange={(event) => patch({ summary: event.target.value })} /></Field><Field label="내 생각"><textarea rows={5} maxLength={20000} value={draft.thoughts} onChange={(event) => patch({ thoughts: event.target.value })} /></Field><section className="grad-quotes-editor"><div className="grad-inline-heading"><h3>인용할 문장</h3><button className="button secondary small" type="button" disabled={draft.quotations.length >= 100} onClick={() => patch({ quotations: [...draft.quotations, { text: "", page: "" }] })}><Plus size={15} />인용문 추가</button></div>{draft.quotations.map((quote, index) => <div className="grad-quote-row" key={index}><Field label={`인용문 ${index + 1}`}><textarea rows={3} maxLength={5000} value={quote.text} onChange={(event) => patch({ quotations: draft.quotations.map((entry, position) => position === index ? { ...entry, text: event.target.value } : entry) })} /></Field><div className="grad-quote-bottom"><Field label={`쪽수 ${index + 1}`}><input placeholder="예: 12 또는 12-14" maxLength={100} value={quote.page} onChange={(event) => patch({ quotations: draft.quotations.map((entry, position) => position === index ? { ...entry, page: event.target.value } : entry) })} /></Field><button className="icon-button" type="button" aria-label={`인용문 ${index + 1} 삭제`} onClick={() => patch({ quotations: draft.quotations.filter((_, position) => position !== index) })}><Trash2 size={16} /></button></div></div>)}</section><section><h3 className="grad-field-label">관련 강좌</h3>{courses.length ? <div className="grad-course-checks">{courses.map((course) => <label key={course.id}><input type="checkbox" checked={draft.courseIds.includes(course.id)} onChange={(event) => patch({ courseIds: event.target.checked ? [...draft.courseIds, course.id] : draft.courseIds.filter((id) => id !== course.id) })} /><span>{displayLabel(course.title)}<small>{displayLabel(course.semester)}</small></span></label>)}</div> : <p className="grad-field-help">등록된 강좌가 없어요. 강좌를 추가한 뒤 연결할 수 있어요.</p>}</section></>}
      {draft.kind === "idea" && <Field label="자유 메모"><textarea className="grad-idea-input" rows={10} maxLength={20000} placeholder="궁금한 질문, 연구의 실마리, 더 알아보고 싶은 내용을 적어 보세요." value={draft.body} onChange={(event) => patch({ body: event.target.value })} /></Field>}
      <TagsInput value={draft.tags} onChange={(value) => change("tags", value)} />
      <LinkPicker workspace={workspace} careers={careers} currentRef={draft.id ? `${draft.kind}:${draft.id}` : undefined} value={draftLinks} onChange={setDraftLinks} />
    </div><div className="modal-footer"><button className="button secondary" type="button" onClick={() => setDraft(null)}>취소</button><button className="button primary" type="submit"><Check size={16} />{busy ? "저장 중..." : "저장"}</button></div></fieldset></form></Modal>}

    {deleteItem && <Modal title={`${sections.find((section) => section.kind === deleteItem.kind)?.name} 삭제`} onClose={() => !busy && setDeleteItem(null)}><div className="modal-body"><p><strong>{displayLabel(deleteItem.title)}</strong> 기록을 삭제할까요?</p><p className="grad-delete-note">{deleteItem.kind === "course" ? "이 강좌에 연결된 과제와 논문 노트는 그대로 남고, 강좌 연결만 해제됩니다." : "다른 이력과 기록은 그대로 남고, 이 항목에 대한 연결만 해제됩니다."}</p>{error && <div className="alert error" role="alert">{error}</div>}</div><div className="modal-footer"><button className="button secondary" disabled={busy} onClick={() => setDeleteItem(null)}>취소</button><button className="button danger" disabled={busy} onClick={remove}><Trash2 size={16} />{busy ? "삭제 중..." : "삭제"}</button></div></Modal>}
  </section>;
}
