import { careerCategoryLabel, recognitionDetails } from "../../shared/career-organization.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Search, ArrowRight, Plus, Upload, FileText } from "lucide-react";
import { materialClassification } from "../../shared/material-classification.mjs";
import { Modal } from "../CareerEditor";
import { rankSearch } from "../archive-tools";
import type { Career, DocumentRecord, View } from "../types";
import type { WorkspaceData } from "./types";
import { displayLabel, workspaceKindIcons, workspaceKindLabels, workspaceItemLabel } from "./WorkspaceUI";

type ResultKind = keyof typeof workspaceKindLabels;
type SearchResult = { ref: string; kind: ResultKind; title: string; detail: string; body: string; tags: string[]; date: string; label?: string; classroom?: boolean };

export default function WorkspaceSearch({ workspace, careers, documents, onOpen, onClose, onView, onCreate, onUpload, busy }: {
  workspace: WorkspaceData; careers: Career[]; documents: DocumentRecord[];
  onOpen: (ref: string) => void; onClose: () => void;
  busy: boolean; onView: (view: View) => void; onCreate: () => void; onUpload: () => void;
}) {
  const [query, setQuery] = useState(""), [kind, setKind] = useState("all"), [tag, setTag] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const entries = useMemo<SearchResult[]>(() => [
    ...careers.map(career => ({ ref: `career:${career.id}`, kind: "career" as const, title: career.title, detail: [careerCategoryLabel(career, documents), career.startDate, career.organization, career.role].filter(Boolean).join(" / "), body: `${career.title} ${careerCategoryLabel(career, documents)} ${recognitionDetails(career).grade} ${recognitionDetails(career).stages.join(" ")} ${career.organization} ${career.role} ${career.description} ${career.startDate} ${career.endDate} ${career.tags.join(" ")}`, tags: career.tags, date: career.startDate })),
    ...documents.map(document => {
      const linked = careers.filter(career => career.documentIds.includes(document.id));
      return { ref: `document:${document.id}`, kind: "document" as const, title: document.name, detail: linked.length ? `${linked.length}개 경력에 연결` : "경력 미연결", body: `${document.name} ${document.text || ""} ${linked.map(career => `${career.title} ${career.organization} ${career.tags.join(" ")}`).join(" ")}`, tags: [...new Set(linked.flatMap(career => career.tags))], date: document.createdAt };
    }),
    ...workspace.items.map(item => ({ ref: `${item.kind}:${item.id}`, kind: item.kind, label: workspaceItemLabel(item), classroom: item.kind === "material" && item.purpose === "classroom", title: item.title, detail: item.kind === "project" ? [item.schoolYear, item.grade, item.subjects.map(subject => subject.subject).join(", ")].filter(Boolean).join(" / ") : item.kind === "material" ? [...materialClassification(item).subjects,...materialClassification(item).trainings,item.format,item.eventName].filter(Boolean).join(" / ") : item.kind === "course" ? [item.semester, item.professor].filter(Boolean).join(" / ") : item.kind === "assignment" ? [item.dueDate, { planned: "예정", "in-progress": "진행 중", submitted: "제출 완료" }[item.status]].filter(Boolean).join(" / ") : item.kind === "paper" ? [item.authors, item.year].filter(Boolean).join(" / ") : "생각과 아이디어", body: `${workspaceItemLabel(item)} ${item.kind === "material" ? JSON.stringify(materialClassification(item)) : ""} ${JSON.stringify(item)}`, tags: item.kind === "material" ? [...new Set([...item.tags,...materialClassification(item).subjects,...materialClassification(item).trainings])] : item.tags, date: item.updatedAt })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "ko")), [workspace, careers, documents]);
  const tags = useMemo(() => [...new Set(entries.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b, "ko")), [entries]);
  const results = rankSearch(entries.filter(entry => (kind === "all" || kind === "classroom" && entry.classroom || kind === "project" && (entry.kind === "project" || entry.classroom) || entry.kind === kind && !entry.classroom || kind === "graduate" && ["course", "assignment", "paper", "idea"].includes(entry.kind)) && (!tag || entry.tags.includes(tag))), query);
  const visible = results.slice(0, 100);
  const selected = Math.min(active, Math.max(0, visible.length - 1));
  const open = (ref: string) => { onClose(); onOpen(ref); };
  useEffect(() => { setActive(0); if (list.current) list.current.scrollTop = 0; }, [query, kind, tag]);
  useEffect(() => { list.current?.querySelector(`[data-search-index="${selected}"]`)?.scrollIntoView({ block: "nearest" }); }, [selected]);
  return <Modal title="모든 기록 검색" onClose={onClose} wide>
    <div className="modal-body command-center">
      <div className="global-search-tools">
        <label className="search-box"><Search size={18} /><input data-autofocus ref={input} role="combobox" aria-expanded="true" aria-controls="archive-search-results" aria-autocomplete="list" aria-activedescendant={visible.length ? `archive-result-${selected}` : undefined} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(value => Math.max(0, Math.min(visible.length - 1, value + (event.key === "ArrowDown" ? 1 : -1)))); }
          if (event.key === "Enter" && visible[selected]) { event.preventDefault(); open(visible[selected].ref); }
        }} aria-label="모든 기록 검색어" placeholder="활동명, 자료 내용, 태그를 입력하세요" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label className="select-wrap"><select aria-label="검색할 기록 종류" value={kind} onChange={event => setKind(event.target.value)}><option value="all">모든 기록</option><option value="career">이력</option><option value="project">수업 전체</option><option value="classroom">학급 자료</option><option value="material">강의 자료</option><option value="graduate">대학원</option><option value="document">공문</option></select><ChevronDown size={13} /></label>
        <label className="select-wrap"><select aria-label="통합 검색 태그" value={tag} onChange={event => setTag(event.target.value)}><option value="">모든 태그</option>{tags.map(value => <option key={value} value={value}>#{displayLabel(value)}</option>)}</select><ChevronDown size={13} /></label>
      </div>
      {!query && kind === "all" && !tag && <nav className="command-actions" aria-label="빠른 작업">
        <button disabled={busy} onClick={() => { onClose(); onCreate(); }}><Plus size={16}/>경력 추가</button>
        <button disabled={busy} onClick={() => { onClose(); onUpload(); }}><Upload size={16}/>공문 업로드</button>
        <button onClick={() => { onClose(); onView("resume"); }}><FileText size={16}/>이력서 만들기</button>
        <button onClick={() => { onClose(); onView("home"); }}><ArrowRight size={16}/>홈으로</button>
      </nav>}
      <p className="global-search-status" aria-live="polite">{query || kind !== "all" || tag ? "검색 결과" : "전체 기록"} {results.length}개{results.length > 100 ? ", 상위 100개 표시" : ""}</p>
      <div ref={list} id="archive-search-results" role="listbox" aria-label="검색 결과" className="global-search-results">{results.length ? visible.map((entry, index) => {
        const Icon = workspaceKindIcons[entry.kind];
        return <button role="option" id={`archive-result-${index}`} data-search-index={index} aria-selected={index === selected} className={`global-search-result ${index === selected ? "selected" : ""}`} key={entry.ref} onFocus={() => setActive(index)} onClick={() => open(entry.ref)}><span className="workspace-link-kind"><Icon size={18} /></span><div><strong>{displayLabel(entry.title)}</strong><small>{entry.label || workspaceKindLabels[entry.kind]}{entry.detail ? ` / ${displayLabel(entry.detail)}` : ""}</small>{entry.tags.length > 0 && <div className="tags">{entry.tags.slice(0, 4).map((value, index) => <span key={`${value}-${index}`}>#{displayLabel(value)}</span>)}</div>}</div><ArrowUpRight size={15} /></button>;
      }) : <p className="workspace-inline-empty">찾는 기록이 없어요. 검색어나 필터를 바꿔 보세요.</p>}</div>
      <footer className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 이동 <kbd>Enter</kbd> 열기</span><span><kbd>Esc</kbd> 닫기</span></footer>
    </div>
  </Modal>;
}
