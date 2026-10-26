import { Layers3, ArrowRight, ArrowUpRight, CalendarDays, Cloud, CloudUpload, FileText, Plus, Star, Search, FileCheck2, CircleHelp, Link2, ArrowDownToLine } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { Career, DocumentRecord, Status, View } from "../types";
import type { WorkspaceData } from "../workspace/types";
import { displayLabel } from "../workspace/WorkspaceUI";
import { archiveAttention } from "../archive-tools";

interface Props {
  careers: Career[]; documents: DocumentRecord[]; workspace: WorkspaceData; status: Status;
  onOpen: (ref: string) => void; onView: (view: View) => void;
  onSearch: () => void; onAttention: (filter: "missing" | "review" | "undated" | "unlinked") => void;
  onOverview: () => void; overview: ReactNode; onUpload: () => void; onCreate: () => void; busy: boolean;
}
export default function HomeDashboard({ careers, documents, workspace, status, onOpen, onView, onUpload, onCreate, onSearch, onAttention, busy, overview, onOverview }: Props) {
  const attention = useMemo(() => archiveAttention(careers, documents), [careers, documents]);
  const favorites = useMemo(() => workspace.items.filter(item => item.favorite && !["course", "assignment", "paper", "idea"].includes(item.kind)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6), [workspace]);
  const tasks = [
    { id: "missing", label: "증빙 보완", detail: "원본 공문 연결", count: attention.missing.length, icon: FileCheck2 },
    { id: "review", label: "내용 확인", detail: "날짜와 역할 검토", count: attention.review.length, icon: CircleHelp },
    { id: "undated", label: "날짜 입력", detail: "활동 기간 정리", count: attention.undated.length, icon: CalendarDays },
    { id: "unlinked", label: "공문 연결", detail: "경력 미연결 원본", count: attention.unlinked.length, icon: Link2 },
  ] as const;
  const dayLabel = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  const backupDate = status.lastBackup ? new Date(status.lastBackup) : null;
  const backupLabel = backupDate && !Number.isNaN(backupDate.getTime())
    ? `마지막 백업 ${new Intl.DateTimeFormat("ko-KR", { timeZone:"Asia/Seoul", dateStyle:"medium", timeStyle:"short" }).format(backupDate)}`
    : status.driveConnected ? "드라이브 연결됨, 백업 상태 확인" : "드라이브 백업 설정";
  return <div className="home-dashboard">
    <header className="home-heading"><div><span className="home-date">{dayLabel}</span><h1>나의 기록실</h1></div><div className="home-actions"><button className="button secondary" onClick={onOverview}><Layers3 size={17}/>이력 한눈에 보기</button><button className="button secondary" onClick={onUpload} disabled={busy}><CloudUpload size={17}/>공문 업로드</button><button className="button primary" onClick={onCreate} disabled={busy}><Plus size={17}/>경력 추가</button></div></header>
    <button className="home-search-launch" onClick={onSearch}><Search size={21}/><span>어떤 기록을 찾으세요?<small>활동명, 기관, 자료 내용, 태그로 검색</small></span><kbd>{/Mac/.test(navigator.platform) ? "⌘ K" : "Ctrl K"}</kbd><ArrowRight size={19}/></button>
    {overview}
    <section className="home-attention home-card" aria-label="정리할 기록">
      <header><h2><FileCheck2 size={18}/>정리할 기록</h2><span>누르면 해당 목록으로 이동</span></header>
      <div className="attention-grid">{tasks.map(({id,label,detail,count,icon:Icon}) => <button key={id} onClick={() => onAttention(id)} disabled={!count} aria-label={`${label} ${count}개`}><span className="attention-icon"><Icon size={18}/></span><span><strong>{label}</strong><small>{detail}</small></span><b>{count}</b><ArrowUpRight size={14}/></button>)}</div>
    </section>
    {favorites.length > 0 && <section className="home-favorites" aria-label="즐겨찾는 기록"><h2><Star size={16}/>즐겨찾기</h2><div>{favorites.map(item => <button key={item.id} onClick={() => onOpen(`${item.kind}:${item.id}`)}><Star size={13}/><span>{displayLabel(item.title)}</span><ArrowUpRight size={13}/></button>)}</div></section>}
    <div className="home-bottom-actions"><button onClick={() => onView("resume")}><FileText size={16}/>이력서와 제출용 증빙 만들기<ArrowUpRight size={14}/></button><button onClick={() => onView("settings")}><ArrowDownToLine size={16}/>전체 기록 백업<ArrowUpRight size={14}/></button></div>
    <button className="home-backup" onClick={() => onView("settings")}><Cloud size={16}/><span>{backupLabel}</span><ArrowUpRight size={14}/></button>
  </div>;
}
