import { useId, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Compass, Map } from "lucide-react";
import type { Career, DocumentRecord } from "../types";
import { growthModel, seoulToday } from "./growth-model";

interface Props {
  careers: Career[]; documents: DocumentRecord[];
  /** Opens the career list for a year (records active in that year). */
  onYear?: (year: number) => void;
  today?: string; onShowCareers?: () => void;
}
const mapY = [69, 43, 63, 28, 49, 24];
function smoothPath(points: { x: number; y: number }[]) {
  return points.map((point, i) => !i ? `M${point.x},${point.y}` : `C${(points[i - 1].x + point.x) / 2},${points[i - 1].y} ${(points[i - 1].x + point.x) / 2},${point.y} ${point.x},${point.y}`).join(" ");
}
// Home keeps only the growth map. The per-year card, the cumulative chart and
// the field list repeated numbers already shown in the KPI tiles and sidebar.
export default function GrowthOverview({ careers, documents, onYear, onShowCareers, today = seoulToday() }: Props) {
  const model = useMemo(() => growthModel(careers, documents, today), [careers, documents, today]);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem("introduce-me-growth-open") !== "false"; } catch { return true; } });
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const id = useId().replaceAll(":", "");
  const journeyYears = model.series.filter(point => point.count > 0);
  const start = Math.min(windowStart ?? Math.max(0, journeyYears.length - 6), Math.max(0, journeyYears.length - 6));
  const visible = journeyYears.slice(start, start + 6);
  const latest = journeyYears.at(-1)?.year;
  const pins = visible.map((point, i) => ({ ...point, x: visible.length === 1 ? 50 : 10 + i * 80 / (visible.length - 1), y: mapY[i] }));
  const route = smoothPath(pins.map(point => ({ x: point.x * 10, y: point.y * 3 })));
  function toggleExpanded() { const next = !expanded; setExpanded(next); try { localStorage.setItem("introduce-me-growth-open", String(next)); } catch { /* Presentation preference only. */ } }
  return <section className="growth-overview" aria-label="나의 성장">
    <div className="growth-section-heading"><div><span className="growth-eyebrow">연도별 발자취</span><h2>나의 성장</h2></div><div className="growth-section-actions"><button onClick={onShowCareers}>이력 목록<ArrowUpRight size={14}/></button><button className="growth-disclosure" aria-expanded={expanded} aria-controls={`${id}-panels`} onClick={toggleExpanded}>{expanded ? "접기" : "펼치기"}<ChevronDown size={16}/></button></div></div>
    {expanded && <div className="growth-dashboard growth-map-only" id={`${id}-panels`}>
      <section className="growth-card journey-card" aria-label="연도별 성장 지도">
        <header className="growth-card-heading"><h3><Map size={17}/>성장 지도</h3><div className="journey-pagination"><button aria-label="성장 지도 이전 연도" disabled={!start} onClick={() => setWindowStart(Math.max(0, start - 6))}><ChevronLeft size={16}/></button><button aria-label="성장 지도 다음 연도" disabled={start + 6 >= journeyYears.length} onClick={() => setWindowStart(Math.min(start + 6, journeyYears.length - 6))}><ChevronRight size={16}/></button></div></header>
        <div className="growth-map-canvas">
          <span className="map-compass" aria-hidden="true"><Compass size={21}/></span>
          {!!pins.length && <svg className="journey-route" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><path d={route} className="route-shadow"/><path d={route} className="route-line"/></svg>}
          {pins.map(point => <button key={point.year} className={`journey-pin ${latest === point.year ? "active" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label={`${point.year}년 이력 보기, 이 해에 시작한 기록 ${point.count}건`} onClick={() => onYear?.(point.year)}><span className="pin-dot"><i/></span><span className="pin-label"><strong>{point.year}</strong><small>{point.count}개 기록</small></span></button>)}
          {!pins.length && <div className="growth-map-empty"><Compass size={28}/><span>날짜가 있는 지난 이력이 없습니다.</span></div>}
        </div>
        <footer className="journey-footer"><span>{visible.length ? `${visible[0].year} — ${visible.at(-1)!.year}` : "성장 기록"}</span><span>연도를 누르면 그해 이력을 보여 줘요 <i/> 전체 {model.total}개 기록</span></footer>
      </section>
      <div className="growth-data-note"><span>오늘까지 시작된 이력 기준</span>{model.unknown.length > 0 && <span>연도 미입력 {model.unknown.length}건 제외</span>}{model.future.length > 0 && <span>예정 {model.future.length}건 제외</span>}</div>
    </div>}
  </section>;
}
