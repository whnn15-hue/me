import { useEffect, useMemo, useState } from "react";
import { Image, Trophy, BookOpen, FileStack, ChevronRight, FileText, Folder, House, Layers3, Clapperboard, GraduationCap, Users, Medal, BriefcaseBusiness, FileCheck2 } from "lucide-react";
import { careerNavigationChoices, matchesCareerCategory } from "../shared/career-organization.mjs";
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
  { view: "materials", label: "교안", icon: FileText },
  { view: "research", label: "연구 자료", icon: FileStack },
  { view: "video", label: "영상 작업", icon: Clapperboard },
] as const;
const careerIcons: Partial<Record<Category | "전체", typeof Layers3>> = {
  전체: Layers3, "강의·연수": GraduationCap, "위원회·지원단": Users, 연구대회: Trophy,
  "공모전 수상": Trophy, 표창: Medal, "활동 경력": BriefcaseBusiness,
  집필: BookOpen, "콘텐츠 제작": Clapperboard, 자격증: FileCheck2,
};
const researchLinks = [
  { view: "research", label: "연구대회 보고서", icon: FileText },
  { view: "submissions", label: "공모전 제출본", icon: Trophy },
  { view: "photos", label: "사진 보관함", icon: Image },
] as const;
const isResearchView = (view: View) => researchViews.some(value => value === view);

export default function WorkspaceTree({ view, careers, documents, category, onView, onCategory, onSection }: Props) {
  const careerLinks = useMemo(() => (["전체", ...careerNavigationChoices] as const).map(value => ({
    value, label: value.replaceAll("·", ", "), icon: careerIcons[value] || Layers3,
    count: value === "전체" ? careers.length : careers.filter(career => matchesCareerCategory(career, value, documents)).length,
  })), [careers, documents]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("c-archive-navigation-v3") || "{}");
      return { careers: saved?.careers === true, projects: saved?.projects === true, research: isResearchView(view) || saved?.research === true };
    } catch { return { careers: false, projects: false, research: isResearchView(view) }; }
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

  useEffect(() => {
    if (view === "careers" && category !== "전체") setBranch("careers", true);
  }, [view, category]);

  function navigate(next: (typeof entries)[number]["view"]) {
    if (next === "research" || next === "projects" || next === "careers") setBranch(next, true);
    if (next === "careers") onCategory("전체");
    else onView(next);
  }

  return <nav className="workspace-tree compact-workspace-tree" aria-label="주 메뉴">
    {entries.map(item => {
      const grouped = item.view === "careers" || item.view === "projects" || item.view === "research";
      const active = item.view === "research" ? isResearchView(view) : view === item.view;
      const expanded = grouped && Boolean(open[item.view]);
      return <div className={`tree-branch ${active ? "current" : ""}`} key={item.view}>
        <div className="tree-parent">
          <button className={`nav-item ${active ? "active" : ""}`} aria-label={item.view === "careers" ? "경력 아카이브" : undefined}
            aria-current={active && !(expanded && (item.view === "research" || item.view === "careers")) ? "page" : undefined} onClick={() => navigate(item.view)}>
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" /><span>{item.label}</span>
          </button>
          {grouped && <button className="tree-toggle" aria-label={`${item.label} 하위 메뉴 ${expanded ? "접기" : "펼치기"}`}
            aria-expanded={expanded} aria-controls={`tree-${item.view}`} onClick={() => setBranch(item.view, !expanded)}><ChevronRight size={15} aria-hidden="true" /></button>}
        </div>
        {expanded && <div className="tree-children" id={`tree-${item.view}`}>
          {item.view === "careers" && careerLinks.map(link => {
            const selected = view === "careers" && (category === link.value || category === "파견" && link.value === "활동 경력");
            return <button key={link.value} className={`tree-career-link ${selected ? "selected" : ""}`}
              aria-label={`이력 분류 ${link.label}, ${link.count}건`} aria-current={selected ? "page" : undefined}
              onClick={() => onCategory(link.value)}><link.icon size={15} aria-hidden="true" /><span>{link.label}</span><small aria-hidden="true">{link.count}</small></button>;
          })}
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
