import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import { Modal } from "../CareerEditor";
import type { Career, DocumentRecord } from "../types";
import type { WorkspaceData } from "./types";
import { displayLabel, workspaceKindIcons, workspaceKindLabels, workspaceItemLabel } from "./WorkspaceUI";

type ResultKind = keyof typeof workspaceKindLabels;
type SearchResult = { ref: string; kind: ResultKind; title: string; detail: string; body: string; tags: string[]; date: string; label?: string; classroom?: boolean };
const fold = (value: string) => displayLabel(value).normalize("NFC").toLocaleLowerCase();
export default function WorkspaceSearch({ workspace, careers, documents, onOpen, onClose }: {
  workspace: WorkspaceData; careers: Career[]; documents: DocumentRecord[];
  onOpen: (ref: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(""), [kind, setKind] = useState("all"), [tag, setTag] = useState("");
  const entries = useMemo<SearchResult[]>(() => [
    ...careers.map(career => ({ ref: `career:${career.id}`, kind: "career" as const, title: career.title, detail: [career.startDate, career.organization, career.role].filter(Boolean).join(" / "), body: `${career.title} ${career.category} ${career.organization} ${career.role} ${career.description} ${career.startDate} ${career.endDate} ${career.tags.join(" ")}`, tags: career.tags, date: career.startDate })),
    ...documents.map(document => {
      const linked = careers.filter(career => career.documentIds.includes(document.id));
      return { ref: `document:${document.id}`, kind: "document" as const, title: document.name, detail: linked.length ? `${linked.length}개 경력에 연결` : "경력 미연결", body: `${document.name} ${document.text || ""} ${linked.map(career => `${career.title} ${career.organization} ${career.tags.join(" ")}`).join(" ")}`, tags: [...new Set(linked.flatMap(career => career.tags))], date: document.createdAt };
    }),
    ...workspace.items.map(item => ({ ref: `${item.kind}:${item.id}`, kind: item.kind, label: workspaceItemLabel(item), classroom: item.kind === "material" && item.purpose === "classroom", title: item.title, detail: item.kind === "project" ? [item.schoolYear, item.grade, item.subjects.map(subject => subject.subject).join(", ")].filter(Boolean).join(" / ") : item.kind === "material" ? [item.ownership === "created" ? "내가 만든 자료" : "모아둔 자료", item.format, item.eventName].filter(Boolean).join(" / ") : item.kind === "course" ? [item.semester, item.professor].filter(Boolean).join(" / ") : item.kind === "assignment" ? [item.dueDate, { planned: "예정", "in-progress": "진행 중", submitted: "제출 완료" }[item.status]].filter(Boolean).join(" / ") : item.kind === "paper" ? [item.authors, item.year].filter(Boolean).join(" / ") : "생각과 아이디어", body: `${workspaceItemLabel(item)} ${JSON.stringify(item)}`, tags: item.tags, date: item.updatedAt })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "ko")), [workspace, careers, documents]);
  const tags = useMemo(() => [...new Set(entries.flatMap(entry => entry.tags))].sort((a, b) => a.localeCompare(b, "ko")), [entries]);
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  const results = entries.filter(entry => (kind === "all" || kind === "classroom" && entry.classroom || kind === "project" && (entry.kind === "project" || entry.classroom) || entry.kind === kind && !entry.classroom || kind === "graduate" && ["course", "assignment", "paper", "idea"].includes(entry.kind)) && (!tag || entry.tags.includes(tag)) && words.every(word => fold(entry.body).includes(word)));
  return <Modal title="모든 기록 검색" subtitle="이력, 수업, 학급 자료, 강의 자료와 대학원 기록을 한 번에 찾아보세요." onClose={onClose} wide>
    <div className="modal-body">
      <div className="global-search-tools">
        <label className="search-box"><Search size={18} /><input autoFocus aria-label="모든 기록 검색어" placeholder="활동명, 자료 내용, 태그를 입력하세요" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label className="select-wrap"><select aria-label="검색할 기록 종류" value={kind} onChange={event => setKind(event.target.value)}><option value="all">모든 기록</option><option value="career">이력</option><option value="project">수업 전체</option><option value="classroom">학급 자료</option><option value="material">강의 자료</option><option value="graduate">대학원</option><option value="document">공문</option></select><ChevronDown size={13} /></label>
        <label className="select-wrap"><select aria-label="통합 검색 태그" value={tag} onChange={event => setTag(event.target.value)}><option value="">모든 태그</option>{tags.map(value => <option key={value} value={value}>#{displayLabel(value)}</option>)}</select><ChevronDown size={13} /></label>
      </div>
      <p className="global-search-status" aria-live="polite">{query || kind !== "all" || tag ? "검색 결과" : "전체 기록"} {results.length}개{results.length > 100 ? ", 최근 100개 표시" : ""}</p>
      <div className="global-search-results">{results.length ? results.slice(0, 100).map(entry => {
        const Icon = workspaceKindIcons[entry.kind];
        return <button className="global-search-result" key={entry.ref} onClick={() => { onClose(); onOpen(entry.ref); }}><span className="workspace-link-kind"><Icon size={18} /></span><div><strong>{displayLabel(entry.title)}</strong><small>{entry.label || workspaceKindLabels[entry.kind]}{entry.detail ? ` / ${displayLabel(entry.detail)}` : ""}</small>{entry.tags.length > 0 && <div className="tags">{entry.tags.slice(0, 4).map((value, index) => <span key={`${value}-${index}`}>#{displayLabel(value)}</span>)}</div>}</div><ArrowUpRight size={15} /></button>;
      }) : <p className="workspace-inline-empty">찾는 기록이 없어요. 검색어나 필터를 바꿔 보세요.</p>}</div>
    </div>
  </Modal>;
}
