import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, Cloud, CloudUpload, FileText, Folder, GraduationCap, Layers3, Plus, Star, Search, FileCheck2, CircleHelp, Link2, ArrowDownToLine } from "lucide-react";
import { useMemo } from "react";
import type { Career, DocumentRecord, Status, View } from "../types";
import type { WorkspaceData, WorkspaceItem } from "../workspace/types";
import { displayLabel } from "../workspace/WorkspaceUI";
import { careerCategoryLabel, careerOrganization } from "../../shared/career-organization.mjs";
import { seoulToday } from "../growth/growth-model";
import { archiveAttention } from "../archive-tools";
import { homeModel } from "./home-model";

interface Props {
  careers: Career[]; documents: DocumentRecord[]; workspace: WorkspaceData; status: Status;
  onOpen: (ref: string) => void; onView: (view: View) => void;
  onSearch: () => void; onAttention: (filter: "missing" | "review" | "undated" | "unlinked") => void;
  onUpload: () => void; onCreate: () => void; busy: boolean;
}
function kindLabel(item: WorkspaceItem) {
  return item.kind === "material" ? item.purpose === "classroom" ? "학급 자료" : "강의 자료" : item.kind === "project" ? "수업" : item.kind === "paper" ? "논문 노트" : "주제 메모";
}
export default function HomeDashboard({ careers, documents, workspace, status, onOpen, onView, onUpload, onCreate, onSearch, onAttention, busy }: Props) {
  const today = seoulToday();
  const model = useMemo(() => homeModel(careers, documents, workspace, today), [careers, documents, workspace, today]);
  const attention = useMemo(() => archiveAttention(careers, documents), [careers, documents]);
  const favorites = useMemo(() => workspace.items.filter(item => item.favorite).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6), [workspace]);
  const tasks = [
    { id: "missing", label: "증빙 보완", detail: "원본 공문 연결", count: attention.missing.length, icon: FileCheck2 },
    { id: "review", label: "내용 확인", detail: "날짜와 역할 검토", count: attention.review.length, icon: CircleHelp },
    { id: "undated", label: "날짜 입력", detail: "활동 기간 정리", count: attention.undated.length, icon: CalendarDays },
    { id: "unlinked", label: "공문 연결", detail: "경력 미연결 원본", count: attention.unlinked.length, icon: Link2 },
  ] as const;
  const shortcuts = [
    { view: "careers", label: "이력", icon: Layers3, count: careers.length, detail: "활동과 증빙" },
    { view: "projects", label: "수업", icon: Folder, count: workspace.items.filter(item => item.kind === "project" || item.kind === "material" && item.purpose === "classroom").length, detail: "수업 기록과 학급 자료" },
    { view: "materials", label: "강의 자료", icon: BookOpen, count: workspace.items.filter(item => item.kind === "material" && item.purpose !== "classroom").length, detail: "강의안과 참고 자료" },
    { view: "graduate", label: "대학원", icon: GraduationCap, count: workspace.items.filter(item => ["course", "assignment", "paper", "idea"].includes(item.kind)).length, detail: "강좌와 연구 노트" },
  ] as const;
  const dayLabel = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  const backupDate = status.lastBackup ? new Date(status.lastBackup) : null;
  const backupLabel = backupDate && !Number.isNaN(backupDate.getTime())
    ? `마지막 백업 ${new Intl.DateTimeFormat("ko-KR", { timeZone:"Asia/Seoul", dateStyle:"medium", timeStyle:"short" }).format(backupDate)}`
    : status.driveConnected ? "드라이브 연결됨, 백업 상태 확인" : "드라이브 백업 설정";
  return <div className="home-dashboard">
    <header className="home-heading"><div><span className="home-date">{dayLabel}</span><h1>나의 기록실</h1></div><div className="home-actions"><button className="button secondary" onClick={onUpload} disabled={busy}><CloudUpload size={17}/>공문 업로드</button><button className="button primary" onClick={onCreate} disabled={busy}><Plus size={17}/>경력 추가</button></div></header>
    <button className="home-search-launch" onClick={onSearch}><Search size={21}/><span>어떤 기록을 찾으세요?<small>활동명, 기관, 자료 내용, 태그로 검색</small></span><kbd>{/Mac/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}</kbd><ArrowRight size={19}/></button>
    <nav className="home-shortcuts" aria-label="기록실 바로가기">{shortcuts.map(({view,label,icon: Icon,count,detail}) => <button key={view} onClick={() => onView(view)}><span className="home-shortcut-top"><Icon size={20}/><ArrowUpRight size={16}/></span><strong>{label}<b>{count}<small>개</small></b></strong><span>{detail}</span></button>)}</nav>
    <section className="home-attention home-card" aria-label="정리할 기록">
      <header><h2><FileCheck2 size={18}/>정리할 기록</h2><span>누르면 해당 목록으로 이동</span></header>
      <div className="attention-grid">{tasks.map(({id,label,detail,count,icon:Icon}) => <button key={id} onClick={() => onAttention(id)} disabled={!count} aria-label={`${label} ${count}개`}><span className="attention-icon"><Icon size={18}/></span><span><strong>{label}</strong><small>{detail}</small></span><b>{count}</b><ArrowUpRight size={14}/></button>)}</div>
    </section>
    {favorites.length > 0 && <section className="home-favorites" aria-label="즐겨찾는 기록"><h2><Star size={16}/>즐겨찾기</h2><div>{favorites.map(item => <button key={item.id} onClick={() => onOpen(`${item.kind}:${item.id}`)}><Star size={13}/><span>{displayLabel(item.title)}</span><ArrowUpRight size={13}/></button>)}</div></section>}
    <div className="home-grid">
      <section className="home-card home-agenda" aria-label="다가오는 일정과 마감">
        <header><h2><CalendarDays size={18}/>일정과 마감</h2><a href="https://calendar.naver.com" target="_blank" rel="noreferrer">네이버 캘린더 열기<ArrowUpRight size={13}/></a></header>
        <div className="home-agenda-summary"><div><strong>{model.agenda.filter(item => item.date === today).length}</strong><span>오늘 일정</span></div><div><strong>{model.assignments.length}</strong><span>미제출 과제</span></div><div><strong>{model.activeProjects.length}</strong><span>진행 중 수업</span></div></div>
        {model.agenda.length ? <ul className="home-rows">{model.agenda.slice(0, 5).map(item => <li key={item.ref}><button onClick={() => onOpen(item.ref)}><time dateTime={item.date} className={item.overdue ? "overdue" : item.date === today ? "today" : ""}><strong>{item.date.slice(5).replace("-", "/")}</strong><small>{item.overdue ? "기한 지남" : item.date === today ? "오늘" : item.date.slice(0, 4)}</small></time><span><small>{item.label} / {displayLabel(item.detail)}</small><strong>{displayLabel(item.title)}</strong></span><ArrowUpRight size={15}/></button></li>)}</ul> : <div className="home-empty"><Check size={24}/><p>등록된 예정 일정이 없습니다.</p><button onClick={() => onView("graduate")}>과제 확인하기<ArrowRight size={14}/></button></div>}
        <footer>앱에 날짜를 입력한 활동과 미제출 과제 기준, 네이버 일정은 아직 동기화되지 않습니다.</footer>
      </section>
      <section className="home-card home-recent" aria-label="최근 작업한 자료">
        <header><h2><FileText size={18}/>최근 작업</h2><span>수정한 순서</span></header>
        {model.recent.length ? <ul className="home-rows">{model.recent.map(item => <li key={item.id}><button onClick={() => onOpen(`${item.kind}:${item.id}`)}><span className="home-row-icon">{item.favorite ? <Star size={18}/> : <FileText size={18}/>}</span><span><small>{kindLabel(item)}</small><strong>{displayLabel(item.title)}</strong></span><ArrowUpRight size={15}/></button></li>)}</ul> : <div className="home-empty"><Folder size={26}/><p>수업과 자료를 모아 보세요.</p><button onClick={() => onView("projects")}>수업 열기<ArrowRight size={14}/></button></div>}
      </section>
      <section className="home-card home-careers" aria-label="최근 활동">
        <header><h2><Layers3 size={18}/>최근 활동</h2><button onClick={() => onView("careers")}>성장 지도와 전체 이력<ArrowUpRight size={14}/></button></header>
        <div className="home-career-grid">{model.recentCareers.map(item => <button key={item.id} onClick={() => onOpen(`career:${item.id}`)}><span>{careerCategoryLabel(item, documents)}<time>{item.startDate.replaceAll("-", ".")}</time></span><strong>{displayLabel(item.title)}</strong><small>{careerOrganization(item, documents)}</small><ArrowUpRight size={15}/></button>)}</div>
        {!model.recentCareers.length && <p className="home-empty">날짜가 있는 지난 활동이 없습니다.</p>}
      </section>
    </div>
    <div className="home-bottom-actions"><button onClick={() => onView("resume")}><FileText size={16}/>이력서와 제출용 증빙 만들기<ArrowUpRight size={14}/></button><button onClick={() => onView("settings")}><ArrowDownToLine size={16}/>전체 기록 백업<ArrowUpRight size={14}/></button></div>
    <button className="home-backup" onClick={() => onView("settings")}><Cloud size={16}/><span>{backupLabel}</span><ArrowUpRight size={14}/></button>
  </div>;
}
