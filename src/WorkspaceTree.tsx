import { useEffect, useState } from "react";
import { Image, Trophy, BookOpen, FileStack, ChevronRight, FileText, Folder, House, Layers3, Clapperboard } from "lucide-react";
import type { Career, Category, DocumentRecord, View } from "./types";
import type { WorkspaceData } from "./workspace/types";
import "./workspace-navigation.css";

interface Props {
  view: View; careers: Career[]; documents: DocumentRecord[]; workspace: WorkspaceData; category: Category | "전체";
  onView: (view: View) => void; onCategory: (category: Category | "전체") => void;
  onSection: (view: View, section?: string, subject?: string) => void;
}

const researchViews = ["research", "submissions", "photos"] as const;
const entries = [
  { view: "home", label: "홈", icon: House },
  { view: "careers", label: "이력", icon: Layers3 },
  { view: "projects", label: "수업", icon: BookOpen },
  { view: "materials", label: "학습 자료", icon: FileText },
  { view: "video", label: "영상 작업", icon: Clapperboard },
  { view: "research", label: "연구 자료", icon: FileStack },
] as const;
const researchLinks = [
  { view: "research", label: "연구대회 보고서", icon: FileText },
  { view: "submissions", label: "공모전 제출본", icon: Trophy },
  { view: "photos", label: "사진 보관함", icon: Image },
] as const;
const isResearchView = (view: View) => researchViews.some(value => value === view);

export default function WorkspaceTree({ view, onView, onCategory, onSection }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("c-archive-navigation-v3") || "{}");
      return { projects: saved.projects === true, research: isResearchView(view) || saved.research === true };
    } catch { return { projects: false, research: isResearchView(view) }; }
  });

  function setBranch(key: string, value: boolean) {
    setOpen(current => {
      const next = { ...current, [key]: value };
      try { localStorage.setItem("c-archive-navigation-v3", JSON.stringify(next)); } catch { /* View preferences are optional. */ }
      return next;
    });
  }

  useEffect(() => {
    // Search results and cross-links must reveal their location in the group.
    if (isResearchView(view)) setBranch("research", true);
  }, [view]);

  function navigate(next: (typeof entries)[number]["view"]) {
    if (next === "research" || next === "projects") setBranch(next, true);
    if (next === "careers") onCategory("전체");
    else onView(next);
  }

  return <nav className="workspace-tree compact-workspace-tree" aria-label="주 메뉴">
    {entries.map(item => {
      const grouped = item.view === "projects" || item.view === "research";
      const active = item.view === "research" ? isResearchView(view) : view === item.view;
      const expanded = grouped && Boolean(open[item.view]);
      return <div className={`tree-branch ${active ? "current" : ""}`} key={item.view}>
        <div className="tree-parent">
          <button className={`nav-item ${active ? "active" : ""}`} aria-label={item.view === "careers" ? "경력 아카이브" : undefined}
            aria-current={active && !(item.view === "research" && expanded) ? "page" : undefined} onClick={() => navigate(item.view)}>
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" /><span>{item.label}</span>
          </button>
          {grouped && <button className="tree-toggle" aria-label={`${item.label} 하위 메뉴 ${expanded ? "접기" : "펼치기"}`}
            aria-expanded={expanded} aria-controls={`tree-${item.view}`} onClick={() => setBranch(item.view, !expanded)}><ChevronRight size={15} aria-hidden="true" /></button>}
        </div>
        {expanded && <div className="tree-children" id={`tree-${item.view}`}>
          {item.view === "projects" && <>
            <button onClick={() => onSection("projects", "records")} aria-label="수업에서 수업 기록 보기"><Folder size={14} aria-hidden="true" /><span>수업 기록</span></button>
            <button onClick={() => onSection("projects", "classroom")} aria-label="수업에서 학급 자료 보기"><BookOpen size={14} aria-hidden="true" /><span>학급 자료</span></button>
          </>}
          {item.view === "research" && researchLinks.map(link => <button key={link.view} className={view === link.view ? "selected" : ""}
            aria-current={view === link.view ? "page" : undefined} onClick={() => onView(link.view)}><link.icon size={14} aria-hidden="true" /><span>{link.label}</span></button>)}
        </div>}
      </div>;
    })}
  </nav>;
}
