import { Layers3, ArrowUpRight, CloudUpload, Plus, Star, FileCheck2, Check } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { Career, DocumentRecord, Status, View } from "../types";
import type { WorkspaceData } from "../workspace/types";
import { displayLabel } from "../workspace/WorkspaceUI";
import { archiveAttention } from "../archive-tools";

interface Props {
  careers: Career[]; documents: DocumentRecord[]; workspace: WorkspaceData; status: Status;
  onOpen: (ref: string) => void; onView: (view: View) => void;
  onAttention: (filter: "missing" | "undated" | "unlinked") => void;
  onOverview: () => void; overview: ReactNode; onUpload: () => void; onCreate: () => void; busy: boolean;
}
export default function HomeDashboard({ careers, documents, workspace, onOpen, onUpload, onCreate, onAttention, busy, overview, onOverview }: Props) {
  const attention = useMemo(() => archiveAttention(careers, documents), [careers, documents]);
  const favorites = useMemo(() => workspace.items.filter(item => item.favorite && !["course", "assignment", "paper", "idea"].includes(item.kind)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6), [workspace]);
  const missing = attention.missing.length;
  return <div className="home-dashboard home-focus">
    <header className="home-focus-toolbar">
      <h1 className="visually-hidden">홈</h1>
      <button className="home-overview-link" onClick={onOverview}><Layers3 size={17}/>이력 한눈에 보기<ArrowUpRight size={14}/></button>
      <div className="home-actions"><button className="button secondary" onClick={onUpload} disabled={busy}><CloudUpload size={17}/>공문 업로드</button><button className="button primary" onClick={onCreate} disabled={busy}><Plus size={17}/>경력 추가</button></div>
    </header>
    <section className="home-evidence-focus" aria-label="증빙 보완할 경력">
      <button className={missing ? "evidence-focus-button" : "evidence-focus-button complete"} onClick={() => onAttention("missing")} disabled={!missing} aria-label={`증빙 보완할 경력 ${missing}건`}>
        <span className="evidence-focus-icon">{missing ? <FileCheck2 size={25} strokeWidth={1.6}/> : <Check size={25}/>}</span>
        <span className="evidence-focus-copy"><strong>증빙 보완할 경력</strong><small>{missing ? "공문을 연결하면 기록이 완성됩니다" : "보완할 증빙이 없습니다"}</small></span>
        <span className="evidence-focus-total"><b>{missing.toLocaleString("ko-KR")}</b><span>건</span></span>
        {missing > 0 && <span className="evidence-focus-next"><span>보완하기</span><ArrowUpRight size={20}/></span>}
      </button>
    </section>
    {overview}
    {favorites.length > 0 && <section className="home-favorites" aria-label="즐겨찾는 기록"><h2><Star size={18} aria-hidden="true"/>즐겨찾기</h2><div>{favorites.map(item => <button key={item.id} onClick={() => onOpen(`${item.kind}:${item.id}`)}><Star size={17} aria-hidden="true"/><span>{displayLabel(item.title)}</span><ArrowUpRight size={13}/></button>)}</div></section>}
  </div>;
}
