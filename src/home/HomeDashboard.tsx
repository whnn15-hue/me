import { Layers3, ArrowUpRight, CloudUpload, Plus, FileCheck2, Check } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { Career, DocumentRecord, Status, View } from "../types";
import type { WorkspaceData } from "../workspace/types";
import { archiveAttention } from "../archive-tools";

interface Props {
  careers: Career[]; documents: DocumentRecord[]; workspace: WorkspaceData; status: Status;
  onOpen: (ref: string) => void; onView: (view: View) => void;
  onAttention: (filter: "missing" | "undated" | "unlinked") => void;
  onOverview: () => void; overview: ReactNode; onUpload: () => void; onCreate: () => void; busy: boolean;
}
export default function HomeDashboard({ careers, documents, onUpload, onCreate, onAttention, busy, overview, onOverview }: Props) {
  const attention = useMemo(() => archiveAttention(careers, documents), [careers, documents]);
  const missing = attention.missing.length;
  return <div className="home-dashboard home-focus">
    <h1 className="visually-hidden">홈</h1>
    {overview}
    <div className="home-support-row">
    <section className="home-evidence-focus" aria-label="증빙 보완할 경력">
      <button className={missing ? "evidence-focus-button" : "evidence-focus-button complete"} onClick={() => onAttention("missing")} disabled={!missing} aria-label={`증빙 보완할 경력 ${missing}건`}>
        <span className="evidence-focus-icon">{missing ? <FileCheck2 size={19} strokeWidth={1.7}/> : <Check size={19}/>}</span>
        <span className="evidence-focus-copy"><strong>{missing ? "증빙 보완할 경력" : "증빙 정리 완료"}</strong></span>
        <span className="evidence-focus-total"><b>{missing.toLocaleString("ko-KR")}</b><span>건</span></span>
        {missing > 0 && <ArrowUpRight size={17}/>}
      </button>
    </section>
    <div className="home-secondary-actions"><button className="home-overview-link" onClick={onOverview}><Layers3 size={16}/>이력 보기</button><button className="home-overview-link" onClick={onUpload} disabled={busy}><CloudUpload size={16}/>공문 업로드</button><button className="button secondary" onClick={onCreate} disabled={busy}><Plus size={16}/>경력 추가</button></div>
    </div>
  </div>;
}
