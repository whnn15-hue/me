import { useId, useMemo, useState, type CSSProperties } from "react";
import { ArrowUpRight, ChevronDown, Compass, RotateCcw, Sparkles } from "lucide-react";
import type { Career, DocumentRecord } from "../types";
import { displayText } from "../display";
import { growthJourney, growthModel, seoulToday } from "./growth-model";
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
  const journey = useMemo(() => growthJourney(model, today), [model, today]);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem("introduce-me-growth-open") !== "false"; } catch { return true; } });
  const [replay, setReplay] = useState(0);
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const id = useId().replaceAll(":", "");
  const { points: visible, first, latest, earlier } = journey;
  const selected = visible.find(point => point.year === (activeYear ?? latest)) ?? visible.at(-1)!;
  const milestone = selected.records.find(record => /연구|수상|표창/.test(record.category)) ?? selected.records.at(-1);
  const hasVisibleRecords = visible.some(point => point.count > 0);
  // Every year stays visible. Height is the cumulative actual record count;
  // zero-record years stay on the same level instead of inventing growth.
  const baseline = earlier.reduce((sum, point) => sum + point.count, 0), high = visible.at(-1)?.cumulative ?? 0;
  const pins = visible.map((point, i) => ({ ...point,
    x: visible.length === 1 ? 50 : 7 + i * 86 / (visible.length - 1),
    y: !hasVisibleRecords ? 68 : visible.length === 1 ? 48 : 76 - ((point.cumulative - baseline) / Math.max(1, high - baseline)) * 37,
  }));
  const route = smoothPath(pins.map(point => ({ x: point.x * 10, y: point.y * 4 })));
  const area = pins.length > 1 ? `${route} L${pins.at(-1)!.x * 10},400 L${pins[0].x * 10},400 Z` : "";
  function toggleExpanded() {
    const next = !expanded; setExpanded(next);
    try { localStorage.setItem("introduce-me-growth-open", String(next)); } catch { /* View preference only. */ }
  }
  return <section className="growth-overview growth-atlas atlas-primary" aria-label="나의 성장">
    <div className="atlas-heading">
      <div><span className="atlas-kicker">GROWTH JOURNEY</span><h2>나의 성장</h2></div>
      <div className="atlas-actions">
        {expanded && hasVisibleRecords && <button className="atlas-replay" aria-label="성장 지도 모션 다시 보기" title="모션 다시 보기" onClick={() => setReplay(value => value + 1)}><RotateCcw size={16}/></button>}
        <button className="atlas-disclosure" aria-expanded={expanded} aria-controls={`${id}-panels`} onClick={toggleExpanded}>{expanded ? "접기" : "펼치기"}<ChevronDown size={16}/></button>
      </div>
    </div>
    {expanded && <section className="atlas-panel" id={`${id}-panels`} aria-label="연도별 성장 지도">
      <div className="atlas-panel-top">
        <span className="atlas-range">{visible[0].year}<span>—</span>{visible.at(-1)!.year}</span>
        <span className="atlas-entire-range">모든 해의 발자취</span>
      </div>
      <div className="atlas-canvas" key={replay}>
        <div className="atlas-horizon" aria-hidden="true"/>
        <svg className="atlas-contours" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
          {[0,1,2,3,4].map(index => <path key={index} d={`M-100,${300 + index * 38} C120,${180 + index * 38} 220,${415 + index * 32} 450,${305 + index * 32} S760,${115 + index * 34} 1110,${165 + index * 38}`}/>)}
        </svg>
        <span className="atlas-watermark" aria-hidden="true">{visible.at(-1)?.year}</span>
        {hasVisibleRecords && <div className="atlas-milestone" aria-label={`${selected.year}년 기록 미리보기`}>
          <span>{selected.year}<i/></span>
          {milestone ? <><strong title={displayText(milestone.title)}>{displayText(milestone.title)}</strong>{milestone.organization && <small>{displayText(milestone.organization)}</small>}</> : <strong className="atlas-milestone-empty">등록된 기록이 없습니다</strong>}
        </div>}
        {pins.length > 1 && <svg className={`atlas-route ${hasVisibleRecords ? "" : "is-empty"}`} viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-trail`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="var(--ui-accent-line)"/><stop offset=".55" stopColor="var(--ui-accent)"/><stop offset="1" stopColor="var(--ui-accent-ink)"/></linearGradient>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--ui-accent)" stopOpacity=".14"/><stop offset="1" stopColor="var(--ui-accent)" stopOpacity="0"/></linearGradient>
          </defs>
          {hasVisibleRecords && <path className="atlas-area" d={area} fill={`url(#${id}-area)`}/>}
          <path className="atlas-trail-base" d={route}/>
          {hasVisibleRecords && <><path className="atlas-trail-glow" d={route} stroke={`url(#${id}-trail)`} pathLength={1000}/><path className="atlas-trail" d={route} stroke={`url(#${id}-trail)`} pathLength={1000}/><circle className="atlas-traveler" r="3.5" fill="var(--ui-accent)"><animateMotion dur="2.4s" begin=".15s" repeatCount="1" path={route} fill="freeze"/></circle></>}
        </svg>}
        {pins.map((point, index) => <button key={point.year} className={`atlas-pin ${latest === point.year ? "is-latest" : ""} ${!point.count ? "is-empty" : ""} ${selected.year === point.year ? "is-selected" : ""}`} style={{ left:`${point.x}%`, top:`${point.y}%`, "--pin-delay":`${.18 + index / Math.max(1,pins.length-1) * 1.6}s` } as CSSProperties} aria-label={`${point.year}년 이력 보기, 이 해에 시작한 기록 ${point.count}건`} title={point.count ? `${point.year}년까지 누적 ${point.cumulative}건` : `${point.year}년 기록 없음`} disabled={!point.count} onMouseEnter={() => setActiveYear(point.year)} onFocus={() => setActiveYear(point.year)} onClick={() => onYear?.(point.year)}>
          <span className="atlas-pin-orbit" aria-hidden="true"/><span className="atlas-pin-core" aria-hidden="true">{latest === point.year ? <Sparkles size={18} strokeWidth={1.8}/> : <i/>}</span>
          <span className="atlas-pin-label"><strong>{point.year}</strong><small>{point.count ? `${point.count}개 기록` : "기록 없음"}<ArrowUpRight size={12}/></small></span>
          {latest === point.year && <span className="atlas-present">최근의 발자취</span>}
        </button>)}
        {!hasVisibleRecords && <div className="atlas-empty"><Compass size={32} strokeWidth={1.2}/><h3>{earlier.length ? "이곳에 다음 발자취를 이어 보세요" : "첫 발자취를 기다리고 있어요"}</h3>{onShowCareers && <button onClick={onShowCareers}>이력 열기<ArrowUpRight size={15}/></button>}</div>}
      </div>
      <footer className="atlas-footer">
        {earlier.length ? <details className="atlas-earlier"><summary>{visible[0].year}년 이전 기록<ChevronDown size={13}/></summary><div>{earlier.map(point=><button key={point.year} onClick={()=>onYear?.(point.year)} aria-label={`${point.year}년 이력 보기, 이 해에 시작한 기록 ${point.count}건`}><strong>{point.year}</strong><span>{point.count}개 기록</span><ArrowUpRight size={13}/></button>)}</div></details> : <span className="atlas-origin"><span className="atlas-origin-dot"/>{first ? `${first}년, 첫 기록부터` : "나의 기록"}</span>}
        <div><details className="atlas-note"><summary>집계 기준</summary><p>2020년부터 올해까지 모든 연도를 표시합니다. 오늘까지 시작한 이력을 시작 연도에 한 번씩 집계하며 선의 높이는 누적 기록 수입니다.{earlier.length > 0 && " 2020년 이전 기록도 누적 수에 포함합니다."}{model.unknown.length > 0 && ` 연도 미입력 ${model.unknown.length}건은 제외했습니다.`}{model.future.length > 0 && ` 예정 이력 ${model.future.length}건은 제외했습니다.`}</p></details>{onShowCareers && <button onClick={onShowCareers}>전체 발자취<ArrowUpRight size={15}/></button>}</div>
      </footer>
    </section>}
  </section>;
}
