import { useState } from "react";
import { Image, Trophy, BookOpen, ChevronRight, FileText, Folder, FolderOpen, GraduationCap, House, Layers3, Settings2, Star } from "lucide-react";
import { careerCategoryChoices, matchesCareerCategory } from "../shared/career-organization.mjs";
import { materialClassification } from "../shared/material-classification.mjs";
import { displayLabel } from "./workspace/WorkspaceUI";
import type { Career, Category, DocumentRecord, View } from "./types";
import type { MaterialItem, WorkspaceData } from "./workspace/types";

interface Props {
  view: View; careers: Career[]; documents: DocumentRecord[]; workspace: WorkspaceData; category: Category | "전체";
  onView: (view: View) => void; onCategory: (category: Category | "전체") => void;
  onSection: (view: View, section?: string, subject?: string) => void;
}
const major = [{view:"careers",label:"이력"},{view:"projects",label:"수업"},{view:"materials",label:"강의 자료"},{view:"graduate",label:"대학원"}] as const;
const minor = [{view:"documents",label:"공문 보관함",icon:FolderOpen},{view:"resume",label:"이력서, 증빙 만들기",icon:FileText},{view:"settings",label:"백업 및 설정",icon:Settings2}] as const;
export default function WorkspaceTree({ view, careers, documents, workspace, category, onView, onCategory, onSection }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { const saved = JSON.parse(localStorage.getItem("introduce-me-tree") || "{}"); return Object.fromEntries(major.map(item => [item.view, typeof saved?.[item.view] === "boolean" ? saved[item.view] : item.view === "careers"])); }
    catch { return { careers: true }; }
  });
  function toggle(key: string) { const next = {...open, [key]: !open[key]}; setOpen(next); try { localStorage.setItem("introduce-me-tree", JSON.stringify(next)); } catch { /* Optional view preference. */ } }
  const lectures = workspace.items.filter((item): item is MaterialItem => item.kind === "material" && item.purpose !== "classroom");
  const subjects = [...new Set(lectures.flatMap(item => materialClassification(item).subjects))].sort((a,b)=>a.localeCompare(b,"ko"));
  return <nav className="workspace-tree" aria-label="주 메뉴">
    <button className={`nav-item ${view === "home" ? "active" : ""}`} aria-current={view === "home" ? "page" : undefined} onClick={() => onView("home")}><House size={19}/><span>홈</span></button>
    {major.map((item,index) => <div className={`tree-branch ${view === item.view ? "current" : ""}`} key={item.view}>
      <div className="tree-parent"><button aria-label={item.view === "careers" ? "경력 아카이브" : undefined} aria-current={view === item.view ? "page" : undefined} className={`nav-item ${view === item.view ? "active" : ""}`} onClick={()=>onView(item.view)}><span className={`workspace-art art-${index}`} aria-hidden="true"/><span>{item.label}</span>{item.view === "careers" && <span className="nav-count">{careers.length}</span>}</button><button className="tree-toggle" aria-label={`${item.label} 하위 메뉴 ${open[item.view] ? "접기" : "펼치기"}`} aria-expanded={Boolean(open[item.view])} aria-controls={`tree-${item.view}`} onClick={()=>toggle(item.view)}><ChevronRight size={15}/></button></div>
      {open[item.view] && <div className="tree-children" id={`tree-${item.view}`}>
        {item.view === "careers" && (["전체", ...careerCategoryChoices] as const).map(choice => <button key={choice} className={view === "careers" && category === choice ? "selected" : ""} aria-label={`이력에서 ${displayLabel(choice)} 보기`} onClick={()=>onCategory(choice)}><i className={`tree-dot tree-color-${careerCategoryChoices.indexOf(choice as Category) % 5}`}/><span>{displayLabel(choice)}</span><small>{choice === "전체" ? careers.length : careers.filter(career=>matchesCareerCategory(career,choice,documents)).length}</small></button>)}
        {item.view === "careers" && <button className={view === "submissions" ? "selected" : ""} onClick={() => onView("submissions")}><Trophy size={13}/><span>공모전 제출본</span><small>{workspace.items.filter(row => row.kind === "submission").length}</small></button>}
        {item.view === "projects" && <><button className={view === "photos" ? "selected" : ""} onClick={() => onView("photos")}><Image size={13}/><span>사진 보관함</span><small>{workspace.items.filter(row => row.kind === "photo").length}</small></button><button onClick={()=>onSection("projects","records")} aria-label="수업에서 수업 기록 보기"><Folder size={13}/><span>수업 기록</span><small>{workspace.items.filter(row=>row.kind==="project").length}</small></button><button onClick={()=>onSection("projects","classroom")} aria-label="수업에서 학급 자료 보기"><BookOpen size={13}/><span>학급 자료</span><small>{workspace.items.filter(row=>row.kind==="material"&&row.purpose==="classroom").length}</small></button></>}
        {item.view === "materials" && <><button onClick={()=>onSection("materials")} aria-label="강의 자료에서 전체 보기"><Layers3 size={13}/><span>전체 자료</span><small>{lectures.length}</small></button><button onClick={()=>onSection("materials","favorites")} aria-label="강의 자료에서 즐겨찾기 보기"><Star size={13}/><span>즐겨찾기</span><small>{lectures.filter(row=>row.favorite).length}</small></button>{subjects.map(subject=><button key={subject} onClick={()=>onSection("materials",undefined,subject)} aria-label={`강의 자료에서 ${subject} 보기`}><i className="tree-dot tree-color-1"/><span>{subject}</span><small>{lectures.filter(row=>materialClassification(row).subjects.includes(subject)).length}</small></button>)}</>}
        {item.view === "graduate" && ([['course','강좌'],['assignment','과제'],['paper','논문 노트'],['idea','논문 주제 메모']] as const).map(([kind,label])=><button key={kind} onClick={()=>onSection("graduate",kind)} aria-label={`대학원에서 ${label} 보기`}><GraduationCap size={13}/><span>{label}</span><small>{workspace.items.filter(row=>row.kind===kind).length}</small></button>)}
      </div>}
    </div>)}
    <div className="workspace-nav-break">ARCHIVE TOOLS</div>
    {minor.map(item=><button key={item.view} className={`nav-item ${view===item.view?'active':''}`} aria-current={view===item.view?'page':undefined} onClick={()=>onView(item.view)}><item.icon size={18}/><span>{item.label}</span></button>)}
  </nav>;
}
