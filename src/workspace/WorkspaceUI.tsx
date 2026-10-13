import { useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, FileText, FolderOpen, GraduationCap, Layers3, Lightbulb, Link2, ListChecks, Plus, Search, X } from "lucide-react";
import type { Career } from "../types";
import { displayText } from "../display";
import type { WorkspaceData, WorkspaceKind } from "./types";

export const displayLabel = displayText;
export const workspaceKindLabels: Record<WorkspaceKind | "career" | "document", string> = {
  career: "이력", project: "프로젝트", material: "강의 자료", course: "수업",
  assignment: "과제", paper: "논문", idea: "메모", document: "공문",
};
export const workspaceKindIcons = {
  career: Layers3, project: FolderOpen, material: FileText, course: GraduationCap,
  assignment: ListChecks, paper: BookOpen, idea: Lightbulb, document: FileText,
};
export function linkedRefs(workspace: WorkspaceData, currentRef: string): string[] {
  return [...new Set(workspace.links.flatMap(link => link.from === currentRef ? [link.to] : link.to === currentRef ? [link.from] : []))];
}
function linkChoices(workspace: WorkspaceData, careers: Career[]) {
  return [
    ...careers.map(career => ({ ref: `career:${career.id}`, kind: "career" as const, title: career.title, subtitle: [career.startDate, career.organization, career.role].filter(Boolean).join(" / "), tags: career.tags })),
    ...workspace.items.map(item => ({ ref: `${item.kind}:${item.id}`, kind: item.kind, title: item.title, subtitle: item.kind === "course" ? [item.semester, item.professor].filter(Boolean).join(" / ") : item.kind === "project" ? [item.schoolYear, item.grade].filter(Boolean).join(" / ") : item.kind === "material" ? item.eventName : workspaceKindLabels[item.kind], tags: item.tags })),
  ];
}
export function LinkPicker({ workspace, careers, currentRef, value, onChange }: {
  workspace: WorkspaceData; careers: Career[]; currentRef?: string;
  value: string[]; onChange: (refs: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => linkChoices(workspace, careers).filter(option => option.ref !== currentRef), [workspace, careers, currentRef]);
  const filtered = options.filter(option => displayLabel(`${option.title} ${option.subtitle} ${workspaceKindLabels[option.kind]} ${option.tags.join(" ")}`).normalize("NFC").toLocaleLowerCase().includes(displayLabel(query).normalize("NFC").trim().toLocaleLowerCase()));
  const toggle = (ref: string, checked: boolean) => onChange(checked ? [...new Set([...value, ref])] : value.filter(item => item !== ref));
  return <div className="workspace-link-picker">
    <div className="workspace-field-heading"><span><Link2 size={15} />관련 기록 연결</span><small>{value.length}개 선택</small></div>
    <p className="workspace-field-hint">연결한 기록의 상세 화면에서도 서로 찾아갈 수 있어요.</p>
    <label className="search-box workspace-link-search"><Search size={15} /><input aria-label="연결할 기록 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="이력, 프로젝트, 자료, 대학원 기록 찾기" /></label>
    {value.length > 0 && <div className="workspace-selected-links">{value.map(ref => {
      const option = options.find(item => item.ref === ref);
      return <span key={ref}>{displayLabel(option?.title || "찾을 수 없는 연결")}<button type="button" aria-label={`${displayLabel(option?.title || "기록")} 연결 해제`} onClick={() => toggle(ref, false)}><X size={12} /></button></span>;
    })}</div>}
    <div className="workspace-link-options">
      {filtered.length ? filtered.map(option => {
        const Icon = workspaceKindIcons[option.kind];
        return <label className="workspace-link-option" key={option.ref}><input type="checkbox" checked={value.includes(option.ref)} onChange={event => toggle(option.ref, event.target.checked)} /><span className="workspace-link-kind"><Icon size={16} /></span><span><strong>{displayLabel(option.title)}</strong><small>{workspaceKindLabels[option.kind]}{option.subtitle ? ` / ${displayLabel(option.subtitle)}` : ""}</small></span></label>;
      }) : <p className="workspace-inline-empty">{options.length ? "검색한 기록이 없어요. 검색어를 바꿔 보세요." : "이력이나 다른 기록을 먼저 추가하면 연결할 수 있어요."}</p>}
    </div>
  </div>;
}
export function RelatedLinks({ workspace, careers, currentRef, onOpen }: {
  workspace: WorkspaceData; careers: Career[]; currentRef: string; onOpen: (ref: string) => void;
}) {
  const refs = linkedRefs(workspace, currentRef);
  const linked = linkChoices(workspace, careers).filter(option => refs.includes(option.ref));
  return <section className="workspace-related" aria-label="연결된 기록">
    <h3><Link2 size={16} />연결된 기록<span>{linked.length}</span></h3>
    {linked.length ? <div>{linked.map(option => {
      const Icon = workspaceKindIcons[option.kind];
      return <button type="button" className="workspace-related-link" key={option.ref} onClick={() => onOpen(option.ref)}><span className="workspace-link-kind"><Icon size={17} /></span><span><small>{workspaceKindLabels[option.kind]}</small><strong>{displayLabel(option.title)}</strong></span><ArrowUpRight size={15} /></button>;
    })}</div> : <p className="workspace-inline-empty">다른 기록과 연결하면 이곳에서 함께 확인할 수 있어요.</p>}
  </section>;
}
export function TagsInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState(""), [error, setError] = useState("");
  function add() {
    const additions = draft.split(/[,\n]/).map(tag => tag.trim().replace(/^#/, "").normalize("NFC")).filter(Boolean);
    const next = [...new Set([...value, ...additions])];
    if (next.some(tag => tag.length > 60)) { setError("태그 하나는 60자 이하로 적어주세요."); return; }
    if (next.length > 30) { setError("태그는 최대 30개까지 추가할 수 있어요."); return; }
    if (additions.length) onChange(next);
    setDraft(""); setError("");
  }
  return <div className="workspace-tags-editor">
    <div className="workspace-field-heading"><span>태그</span><small>여러 기록을 하나의 주제로 묶어요</small></div>
    <div className="tag-editor">{value.map((tag, index) => <span key={`${tag}-${index}`}>#{displayLabel(tag)}<button type="button" aria-label={`${displayLabel(tag)} 태그 삭제`} onClick={() => onChange(value.filter((_, selected) => selected !== index))}><X size={12} /></button></span>)}<input aria-label="태그 추가" placeholder="태그 입력 후 Enter" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} /><button className="icon-button" type="button" aria-label="입력한 태그 추가" onClick={add} disabled={!draft.trim()}><Plus size={16} /></button></div>
    {error && <p className="workspace-field-hint" role="alert">{error}</p>}
  </div>;
}
