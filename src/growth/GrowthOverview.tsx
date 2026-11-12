import { useId, useMemo, useState, type CSSProperties } from "react";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Compass, RotateCcw, Sparkles } from "lucide-react";
import type { Career, DocumentRecord } from "../types";
import { growthModel, seoulToday } from "./growth-model";
import "./atlas.css";

interface Props {
  careers: Career[]; documents: DocumentRecord[];
  /** Opens the career list for the year in which a record started. */
  onYear?: (year: number) => void;
  today?: string; onShowCareers?: () => void;
}
function smoothPath(points: { x: number; y: number }[]) {
  return points.map((point, i) => !i ? `M${point.x},${point.y}` : `C${(points[i - 1].x + point.x) / 2},${points[i - 1].y} ${(points[i - 1].x + point.x) / 2},${point.y} ${point.x},${point.y}`).join(" ");
}

export default function GrowthOverview({ careers, documents, onYear, onShowCareers, today = seoulToday() }: Props) {
  const model = useMemo(() => growthModel(careers, documents, today), [careers, documents, today]);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem("introduce-me-growth-open") !== "false"; } catch { return true; } });
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [replay, setReplay] = useState(0);
  const id = useId().replaceAll(":", "");
  const journeyYears = model.series.filter(point => point.count > 0);
  const start = Math.min(windowStart ?? Math.max(0, journeyYears.length - 6), Math.max(0, journeyYears.length - 6));
  const visible = journeyYears.slice(start, start + 6);
  const latest = journeyYears.at(-1)?.year;
  const first = journeyYears[0]?.year;
  // Height reflects cumulative actual records in this window, not an invented
  // performance score. Keep the bounds fixed so every label remains readable.
  const low = visible[0]?.cumulative ?? 0, high = visible.at(-1)?.cumulative ?? 0;
  const pins = visible.map((point, i) => ({ ...point,
    x: visible.length === 1 ? 50 : 9 + i * 82 / (visible.length - 1),
    y: visible.length === 1 ? 48 : 69 - ((point.cumulative - low) / Math.max(1, high - low)) * 42,
  }));
  const route = smoothPath(pins.map(point => ({ x: point.x * 10, y: point.y * 4 })));
  const area = pins.length > 1 ? `${route} L${pins.at(-1)!.x * 10},400 L${pins[0].x * 10},400 Z` : "";
  function toggleExpanded() {
    const next = !expanded; setExpanded(next);
    try { localStorage.setItem("introduce-me-growth-open", String(next)); } catch { /* View preference only. */ }
  }
  return <section className="growth-overview growth-atlas" aria-label="나의 성장">
    <div className="atlas-heading">
      <div><span className="atlas-kicker">나의 기록이 이어진 시간</span><h2>나의 성장</h2></div>
      <div className="atlas-actions">
        {expanded && pins.length > 0 && <button className="atlas-replay" aria-label="성장 지도 모션 다시 보기" title="모션 다시 보기" onClick={() => setReplay(value => value + 1)}><RotateCcw size={16}/></button>}
        <button className="atlas-disclosure" aria-expanded={expanded} aria-controls={`${id}-panels`} onClick={toggleExpanded}>{expanded ? "접기" : "펼치기"}<ChevronDown size={16}/></button>
      </div>
    </div>
    {expanded && <section className="atlas-panel" id={`${id}-panels`} aria-label="연도별 성장 지도">
      <div className="atlas-panel-top">
        <span className="atlas-range">{visible.length ? <>{visible[0].year}<span>—</span>{visible.at(-1)!.year}</> : "성장 지도"}</span>
        <div className="atlas-pagination">
          <span>{journeyYears.length > 6 ? `${start + 1}–${Math.min(start + 6, journeyYears.length)} / ${journeyYears.length}` : "연도별 발자취"}</span>
          {journeyYears.length > 6 && <><button aria-label="성장 지도 이전 연도" disabled={!start} onClick={() => setWindowStart(Math.max(0, start - 6))}><ChevronLeft size={17}/></button><button aria-label="성장 지도 다음 연도" disabled={start + 6 >= journeyYears.length} onClick={() => setWindowStart(Math.min(start + 6, journeyYears.length - 6))}><ChevronRight size={17}/></button></>}
        </div>
      </div>
      <div className="atlas-canvas" key={`${start}-${replay}`}>
        <div className="atlas-horizon" aria-hidden="true"/>
        <svg className="atlas-contours" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
          {[0,1,2,3,4].map(index => <path key={index} d={`M-100,${300 + index * 38} C120,${180 + index * 38} 220,${415 + index * 32} 450,${305 + index * 32} S760,${115 + index * 34} 1110,${165 + index * 38}`}/>)}
        </svg>
        {latest && <span className="atlas-watermark" aria-hidden="true">{visible.at(-1)?.year}</span>}
        {pins.length > 1 && <svg className="atlas-route" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-trail`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="var(--ui-accent-line)"/><stop offset=".55" stopColor="var(--ui-accent)"/><stop offset="1" stopColor="var(--ui-accent-ink)"/></linearGradient>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--ui-accent)" stopOpacity=".11"/><stop offset="1" stopColor="var(--ui-accent)" stopOpacity="0"/></linearGradient>
          </defs>
          <path className="atlas-area" d={area} fill={`url(#${id}-area)`}/>
          <path className="atlas-trail-base" d={route}/>
          <path className="atlas-trail-glow" d={route} stroke={`url(#${id}-trail)`} pathLength={1000}/>
          <path className="atlas-trail" d={route} stroke={`url(#${id}-trail)`} pathLength={1000}/>
        </svg>}
        {pins.map((point, index) => <button key={point.year} className={`atlas-pin ${latest === point.year ? "is-latest" : ""}`} style={{ left:`${point.x}%`, top:`${point.y}%`, "--pin-delay":`${.28 + index * .24}s` } as CSSProperties} aria-label={`${point.year}년 이력 보기, 이 해에 시작한 기록 ${point.count}건`} title={`${point.year}년까지 누적 ${point.cumulative}건`} onClick={() => onYear?.(point.year)}>
          <span className="atlas-pin-orbit" aria-hidden="true"/><span className="atlas-pin-core" aria-hidden="true">{latest === point.year ? <Sparkles size={18} strokeWidth={1.8}/> : <i/>}</span>
          <span className="atlas-pin-label"><strong>{point.year}</strong><small>{point.count}개 기록<ArrowUpRight size={12}/></small></span>
          {latest === point.year && <span className="atlas-present">가장 최근의 발자취</span>}
        </button>)}
        {!pins.length && <div className="atlas-empty"><Compass size={38} strokeWidth={1.2}/><h3>첫 발자취를 기다리고 있어요</h3><p>활동 날짜가 있는 이력이 이곳에 이어집니다.</p>{onShowCareers && <button onClick={onShowCareers}>이력 열기<ArrowUpRight size={15}/></button>}</div>}
      </div>
      <footer className="atlas-footer">
        <span className="atlas-origin"><span className="atlas-origin-dot"/>{first ? `${first}년, 첫 기록부터` : "나의 기록"}</span>
        <div><details className="atlas-note"><summary>집계 기준</summary><p>오늘까지 시작한 이력을 시작 연도에 한 번씩 표시합니다. 선의 높이는 누적 기록 수입니다.{model.unknown.length > 0 && ` 연도 미입력 ${model.unknown.length}건은 제외했습니다.`}{model.future.length > 0 && ` 예정 이력 ${model.future.length}건은 제외했습니다.`}</p></details>{onShowCareers && <button onClick={onShowCareers}>전체 발자취<ArrowUpRight size={15}/></button>}</div>
      </footer>
    </section>}
  </section>;
}
