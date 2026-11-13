import { careerCategoryLabel, recognitionDetails } from "../../shared/career-organization.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import { recordTags, materialClassification } from "../../shared/material-classification.mjs";
import { materialLibrary } from "../../shared/resources.mjs";
import { rankSearch } from "../archive-tools";
import "./WorkspaceSearch.css";
import type { Career, DocumentRecord } from "../types";
import type { WorkspaceData } from "./types";
import { displayLabel, workspaceKindIcons, workspaceKindLabels, workspaceItemLabel } from "./WorkspaceUI";

type ResultKind = keyof typeof workspaceKindLabels;
type SearchResult = { ref: string; kind: ResultKind; title: string; detail: string; body: string; tags: string[]; date: string; label?: string; classroom?: boolean; lesson?: boolean; research?: boolean; video?: boolean };

function matchesKind(entry: SearchResult, kind: string) {
  if (kind === "all") return true;
  if (kind === "classroom") return entry.classroom;
  if (kind === "lesson") return entry.lesson;
  if (kind === "research") return entry.research;
  if (kind === "video") return entry.video;
  if (kind === "material") return entry.kind === "material" && !entry.classroom && !entry.lesson && !entry.research && !entry.video;
  if (kind === "project") return entry.kind === "project" || entry.classroom || entry.lesson;
  return entry.kind === kind;
}

export default function WorkspaceSearch({ workspace, careers, documents, onOpen, onClose }: {
  workspace: WorkspaceData; careers: Career[]; documents: DocumentRecord[];
  onOpen: (ref: string) => void; onClose?: () => void;
}) {
  const [query, setQuery] = useState(""), [kind, setKind] = useState("all"), [tag, setTag] = useState("");
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setExpanded(true);
      input.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);
  const entries = useMemo<SearchResult[]>(() => [
    ...careers.map(career => ({ ref: `career:${career.id}`, kind: "career" as const, title: career.title, detail: [careerCategoryLabel(career, documents), career.startDate, career.organization, career.role].filter(Boolean).join(" / "), body: `${career.title} ${careerCategoryLabel(career, documents)} ${recognitionDetails(career).grade} ${recognitionDetails(career).stages.join(" ")} ${career.organization} ${career.role} ${career.description} ${career.startDate} ${career.endDate} ${career.tags.join(" ")}`, tags: career.tags, date: career.startDate })),
    ...documents.map(document => {
      const linked = careers.filter(career => career.documentIds.includes(document.id));
      return { ref: `document:${document.id}`, kind: "document" as const, title: document.name, detail: linked.length ? `${linked.length}개 경력에 연결` : "경력 미연결", body: `${document.name} ${document.text || ""} ${linked.map(career => `${career.title} ${career.organization} ${career.tags.join(" ")}`).join(" ")}`, tags: [...new Set(linked.flatMap(career => career.tags))], date: document.createdAt };
    }),
    ...workspace.items.map(item => ({...item, tags: item.kind === "material" && item.purpose === "research" ? item.tags : recordTags(item)})).filter(item => !["course", "assignment", "paper", "idea"].includes(item.kind)).map(item => ({ ref: `${item.kind}:${item.id}`, kind: item.kind, label: workspaceItemLabel(item), classroom: item.kind === "material" && item.purpose === "classroom" && item.schoolSection !== "lesson", lesson: item.kind === "material" && item.purpose === "classroom" && item.schoolSection === "lesson", research: item.kind === "material" && item.purpose === "research", video: item.kind === "material" && item.purpose !== "classroom" && item.purpose !== "research" && materialLibrary(item) === "video", title: item.title, detail: item.kind === "material" && item.purpose === "research" ? [item.researchType || "기타", item.date.slice(0, 4), item.eventName, item.format].filter(Boolean).join(" / ") : item.kind === "project" ? [item.schoolYear, item.grade, item.subjects.map(subject => subject.subject).join(", ")].filter(Boolean).join(" / ") : item.kind === "material" ? [...materialClassification(item).subjects,...materialClassification(item).trainings,item.format].filter(Boolean).join(" / ") : item.kind === "course" ? [item.semester, item.professor].filter(Boolean).join(" / ") : item.kind === "assignment" ? [item.dueDate, { planned: "예정", "in-progress": "진행 중", submitted: "제출 완료" }[item.status]].filter(Boolean).join(" / ") : item.kind === "paper" ? [item.authors, item.year].filter(Boolean).join(" / ") : "생각과 아이디어", body: `${workspaceItemLabel(item)} ${item.kind === "material" ? JSON.stringify(materialClassification(item)) : ""} ${JSON.stringify(item)}`, tags: item.kind === "material" && item.purpose !== "research" ? [...new Set([...item.tags,...materialClassification(item).subjects,...materialClassification(item).trainings])] : item.tags, date: item.updatedAt })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "ko")), [workspace, careers, documents]);
  const tags = useMemo(() => [...new Set(entries.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b, "ko")), [entries]);
  const hasSearch = Boolean(query.trim() || kind !== "all" || tag);
  const results = hasSearch ? rankSearch(entries.filter(entry => matchesKind(entry, kind) && (!tag || entry.tags.includes(tag))), query) : [];
  const visible = results.slice(0, 100);
  const selected = Math.min(active, Math.max(0, visible.length - 1));
  const close = () => { setExpanded(false); onClose?.(); };
  const open = (ref: string) => { close(); input.current?.blur(); onOpen(ref); };
  useEffect(() => { setActive(0); if (list.current) list.current.scrollTop = 0; }, [query, kind, tag]);
  useEffect(() => { list.current?.querySelector(`[data-search-index="${selected}"]`)?.scrollIntoView({ block: "nearest" }); }, [selected, expanded]);
  return <div className="header-search" ref={container} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
  }} onKeyDown={event => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && expanded) {
      event.preventDefault(); event.stopPropagation(); input.current?.focus(); close();
    }
  }}>
    <form className={`header-search-field ${expanded ? "is-open" : ""}`} role="search" aria-label="통합 검색" onSubmit={event => { event.preventDefault(); setExpanded(true); input.current?.focus(); }}>
      <input ref={input} role="combobox" aria-expanded={expanded} aria-controls={expanded ? "archive-search-results" : undefined} aria-autocomplete="list" aria-activedescendant={expanded && visible.length ? `archive-result-${selected}` : undefined}
        aria-label="모든 기록 검색어" placeholder="통합 검색" autoComplete="off" spellCheck={false} value={query} onFocus={() => setExpanded(true)} onChange={event => { setQuery(event.target.value); setExpanded(true); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setExpanded(true);
            setActive(value => Math.max(0, Math.min(visible.length - 1, value + (event.key === "ArrowDown" ? 1 : -1))));
          }
          if (event.key === "Enter" && expanded && visible[selected]) { event.preventDefault(); open(visible[selected].ref); }
        }}/>
      <kbd aria-hidden="true">{typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}</kbd>
      <button type="submit" aria-label="통합 검색 실행"><Search size={19}/></button>
    </form>
    {expanded && <section className="header-search-popover command-center" aria-label="통합 검색 결과">
      <div className="global-search-tools">
        <label className="select-wrap"><select aria-label="검색할 기록 종류" value={kind} onChange={event => setKind(event.target.value)}><option value="all">모든 기록</option><option value="career">이력</option><option value="project">학교 전체</option><option value="lesson">수업 자료</option><option value="classroom">학급 자료</option><option value="material">교안</option><option value="video">영상 작업</option><option value="research">연구대회 자료</option><option value="photo">사진</option><option value="submission">공모전 제출본</option><option value="document">공문</option></select><ChevronDown size={13} /></label>
        <label className="select-wrap"><select aria-label="통합 검색 태그" value={tag} onChange={event => setTag(event.target.value)}><option value="">모든 태그</option>{tags.map(value => <option key={value} value={value}>#{displayLabel(value)}</option>)}</select><ChevronDown size={13} /></label>
      </div>
      {hasSearch && <p className="global-search-status" aria-live="polite">검색 결과 {results.length}개{results.length > 100 ? ", 상위 100개 표시" : ""}</p>}
      <div ref={list} id="archive-search-results" role="listbox" aria-label="검색 결과" className="global-search-results">{results.length ? visible.map((entry, index) => {
        const Icon = workspaceKindIcons[entry.kind];
        return <button role="option" id={`archive-result-${index}`} data-search-index={index} aria-selected={index === selected} className={`global-search-result ${index === selected ? "selected" : ""}`} key={entry.ref} onFocus={() => setActive(index)} onClick={() => open(entry.ref)}><span className="workspace-link-kind"><Icon size={18} /></span><div><strong>{displayLabel(entry.title)}</strong><small>{entry.label || workspaceKindLabels[entry.kind]}{entry.detail ? ` / ${displayLabel(entry.detail)}` : ""}</small>{entry.tags.length > 0 && <div className="tags">{entry.tags.slice(0, 4).map((value, index) => <span key={`${value}-${index}`}>#{displayLabel(value)}</span>)}</div>}</div><ArrowUpRight size={15} /></button>;
      }) : <p className="workspace-inline-empty">{hasSearch ? "찾는 기록이 없어요. 검색어나 필터를 바꿔 보세요." : "검색어를 입력해 주세요."}</p>}</div>
      <footer className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 이동 <kbd>Enter</kbd> 열기</span><span><kbd>Esc</kbd> 닫기</span></footer>
    </section>}
  </div>;
}
