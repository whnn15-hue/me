import { useId, useMemo, useState } from "react";
import { ArrowUpRight, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight, Compass, Eye, Map, Sparkles } from "lucide-react";
import type { Career, Category, DocumentRecord } from "../types";
import { displayLabel } from "../workspace/WorkspaceUI";
import { careerCategoryLabel, careerOrganization, recognitionDetails } from "../../shared/career-organization.mjs";
import { growthModel, seoulToday } from "./growth-model";

interface Props {
  careers: Career[]; documents: DocumentRecord[];
  onOpen: (ref: string) => void; onCategory: (category: Category) => void;
  today?: string;
}
const mapY = [69, 43, 63, 28, 49, 24];
function smoothPath(points: { x: number; y: number }[]) {
  return points.map((point, i) => !i ? `M${point.x},${point.y}` : `C${(points[i - 1].x + point.x) / 2},${points[i - 1].y} ${(points[i - 1].x + point.x) / 2},${point.y} ${point.x},${point.y}`).join(" ");
}
export default function GrowthOverview({ careers, documents, onOpen, onCategory, today = seoulToday() }: Props) {
  const model = useMemo(() => growthModel(careers, documents, today), [careers, documents, today]);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem("introduce-me-growth-open") !== "false"; } catch { return true; } });
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<"annual" | "cumulative">("cumulative");
  const [range, setRange] = useState("6");
  const [showTable, setShowTable] = useState(false);
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const id = useId().replaceAll(":", "");
  const journeyYears = model.series.filter(point => point.count > 0);
  const start = Math.min(windowStart ?? Math.max(0, journeyYears.length - 6), Math.max(0, journeyYears.length - 6));
  const visible = journeyYears.slice(start, start + 6);
  const active = model.series.find(point => point.year === selectedYear) ?? journeyYears.at(-1);
  const pins = visible.map((point, i) => ({ ...point, x: visible.length === 1 ? 50 : 10 + i * 80 / (visible.length - 1), y: mapY[i] }));
  const route = smoothPath(pins.map(point => ({ x: point.x * 10, y: point.y * 3 })));
  const chartSeries = range === "all" ? model.series : model.series.slice(-Number(range));
  const maxValue = Math.max(1, ...chartSeries.map(point => chartMode === "annual" ? point.count : point.cumulative));
  const chartPoints = chartSeries.map((point, i) => ({ ...point, x: chartSeries.length === 1 ? 320 : 38 + i * 556 / (chartSeries.length - 1), y: 170 - (chartMode === "annual" ? point.count : point.cumulative) / maxValue * 132 }));
  const chartPath = chartPoints.map((point, i) => `${i ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const chartFocus = chartSeries.find(point => point.year === hoverYear) ?? chartSeries.at(-1);
  const rows = active?.records.slice().sort((a, b) => b.startDate.localeCompare(a.startDate)) ?? [];
  const allCategories = model.categories;
  const categoryTotal = allCategories.reduce((sum, item) => sum + item.count, 0);
  let angle = 0;
  const gradient = allCategories.map(item => { const begin = angle; angle += item.count / categoryTotal * 360; return `${item.color} ${begin}deg ${angle}deg`; }).join(", ");
  function selectYear(year: number) { setSelectedYear(year); const index = journeyYears.findIndex(point => point.year === year); if (index >= 0 && (index < start || index >= start + 6)) setWindowStart(Math.min(index, Math.max(0, journeyYears.length - 6))); }
  function toggleExpanded() { const next = !expanded; setExpanded(next); try { localStorage.setItem("introduce-me-growth-open", String(next)); } catch { /* Presentation preference only. */ } }
  return <section className="growth-overview" aria-label="나의 성장">
    <div className="growth-section-heading"><div><span className="growth-eyebrow">MY JOURNEY</span><h2>나의 성장</h2></div><div className="growth-section-actions"><a href="#career-records">이력 목록<ArrowUpRight size={14}/></a><button className="growth-disclosure" aria-expanded={expanded} aria-controls={`${id}-panels`} onClick={toggleExpanded}>{expanded ? "접기" : "펼치기"}<ChevronDown size={16}/></button></div></div>
    {expanded && <div className="growth-dashboard" id={`${id}-panels`}>
      <section className="growth-card journey-card" aria-label="연도별 성장 지도">
        <header className="growth-card-heading"><h3><Map size={17}/>성장 지도</h3><div className="journey-pagination"><button aria-label="성장 지도 이전 연도" disabled={!start} onClick={() => setWindowStart(Math.max(0, start - 6))}><ChevronLeft size={16}/></button><button aria-label="성장 지도 다음 연도" disabled={start + 6 >= journeyYears.length} onClick={() => setWindowStart(Math.min(start + 6, journeyYears.length - 6))}><ChevronRight size={16}/></button></div></header>
        <div className="growth-map-canvas">
          <img className="growth-landscape" src="/art/growth-landscape.webp" alt="" width="1536" height="1024" aria-hidden="true"/>
          <span className="map-compass" aria-hidden="true"><Compass size={21}/></span>
          {!!pins.length && <svg className="journey-route" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><path d={route} className="route-shadow"/><path d={route} className="route-line"/></svg>}
          {pins.map(point => <button key={point.year} className={`journey-pin ${active?.year === point.year ? "active" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-pressed={active?.year === point.year} aria-label={`${point.year}년 성장 기록 ${point.count}건`} onClick={() => selectYear(point.year)}><span className="pin-dot"><i/></span><span className="pin-label"><strong>{point.year}</strong><small>{point.count}개 기록</small></span></button>)}
          {!pins.length && <div className="growth-map-empty"><Compass size={28}/><span>날짜가 있는 지난 이력이 없습니다.</span></div>}
        </div>
        <footer className="journey-footer"><span>{visible.length ? `${visible[0].year} — ${visible.at(-1)!.year}` : "성장 기록"}</span><span>연도별 경로 <i/> {model.total}개 기록</span></footer>
      </section>
      <section className="growth-card journey-detail" aria-label="선택한 연도 기록">
        <header className="growth-card-heading"><h3><Sparkles size={16}/>{active ? `${active.year}년의 기록` : "연도별 기록"}</h3><span className="growth-count">{active?.count ?? 0}</span></header>
        <div className="journey-detail-total"><strong>{active?.cumulative ?? 0}<small>건</small></strong><span>이 연도까지 누적된 이력</span></div>
        <ul className="journey-records">{rows.map(career => {
          const badge = recognitionDetails(career);
          return <li key={career.id}><button onClick={() => onOpen(`career:${career.id}`)}><span><small>{careerCategoryLabel(career, documents)}{badge.grade && ` / ${displayLabel(badge.grade)}`}</small><strong>{displayLabel(career.title)}</strong><em>{careerOrganization(career, documents)}</em></span><ArrowUpRight size={16}/></button></li>;
        })}</ul>
        {!rows.length && <p className="growth-empty">지도에서 연도를 선택해 주세요.</p>}
      </section>
      <section className="growth-card activity-chart" aria-label="연도별 성장 차트">
        <header className="growth-card-heading"><h3><ChartNoAxesCombined size={17}/>기록의 흐름</h3><select aria-label="성장 차트 기간" value={range} onChange={event => setRange(event.target.value)}><option value="6">최근 6년</option><option value="12">최근 12년</option><option value="all">전체 연도</option></select></header>
        <div className="chart-overview-line"><div aria-live="polite"><strong>{chartFocus ? chartMode === "annual" ? chartFocus.count : chartFocus.cumulative : 0}<small>건</small></strong><span>{chartFocus?.year}년 {chartMode === "annual" ? "시작한 이력" : "누적 기록"}</span></div><div className="segmented-control" role="group" aria-label="성장 차트 방식"><button aria-pressed={chartMode === "cumulative"} onClick={() => setChartMode("cumulative")}>누적</button><button aria-pressed={chartMode === "annual"} onClick={() => setChartMode("annual")}>연도별</button></div></div>
        <div className="chart-drawing">
          <svg viewBox="0 0 640 210" role="img" aria-label={`${chartMode === "annual" ? "연도별" : "누적"} 이력 건수, 아래 연도 버튼과 수치 표에서 상세 확인`}>
            <defs><linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--ui-chart)" stopOpacity=".24"/><stop offset="100%" stopColor="var(--ui-chart)" stopOpacity=".01"/></linearGradient></defs>
            {[0, .5, 1].map(ratio => <g key={ratio}><line x1="38" x2="606" y1={170 - ratio * 132} y2={170 - ratio * 132} stroke="var(--ui-border)" strokeDasharray="4 5"/><text x="25" y={174 - ratio * 132} textAnchor="end" className="chart-axis">{Number((maxValue * ratio).toFixed(1))}</text></g>)}
            {chartMode === "cumulative" && chartPoints.length > 0 && <><path d={`${chartPath} L${chartPoints.at(-1)!.x},170 L${chartPoints[0].x},170 Z`} fill={`url(#${id}-fill)`}/><path d={chartPath} fill="none" stroke="var(--ui-chart)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></>}
            {chartPoints.map((point, i) => <g key={point.year}>{chartMode === "annual" ? <rect x={point.x - Math.min(12, 180 / chartPoints.length)} y={point.y} width={Math.min(24, 360 / chartPoints.length)} height={170 - point.y} rx="4" fill={point.year === active?.year ? "var(--ui-chart)" : "var(--ui-chart-soft)"}/> : <circle cx={point.x} cy={point.y} r={point.year === hoverYear ? 5 : 3.5} fill="var(--ui-surface)" stroke="var(--ui-chart)" strokeWidth="2"/>}{(chartPoints.length < 10 || i % Math.ceil(chartPoints.length / 7) === 0 || i === chartPoints.length - 1) && <text x={point.x} y="197" textAnchor="middle" className="chart-axis">{point.year}</text>}</g>)}
          </svg>
          <div className="chart-hit-targets">{chartPoints.map(point => <button key={point.year} style={{ left: `${point.x / 640 * 100}%`, width: `${Math.min(8, 85 / chartPoints.length)}%` }} aria-label={`${point.year}년 ${chartMode === "annual" ? point.count : point.cumulative}건 보기`} onMouseEnter={() => setHoverYear(point.year)} onMouseLeave={() => setHoverYear(null)} onFocus={() => setHoverYear(point.year)} onBlur={() => setHoverYear(null)} onClick={() => selectYear(point.year)} />)}</div>
        </div>
        <div className="chart-note"><span>활동 시작 연도 기준</span><button aria-expanded={showTable} onClick={() => setShowTable(!showTable)}><Eye size={13}/>{showTable ? "수치 접기" : "수치 보기"}</button></div>
        <div className="chart-context"><div><span>기록된 기관</span><strong>{model.organizations}<small>곳</small></strong></div><div><span>활동한 연도</span><strong>{journeyYears.length}<small>개년</small></strong></div></div>
        {showTable && <div className="growth-data-table"><table><caption>활동 시작 연도별 이력 건수</caption><thead><tr><th>연도</th><th>해당 연도</th><th>누적</th></tr></thead><tbody>{chartSeries.map(point => <tr key={point.year}><th><button onClick={() => selectYear(point.year)}>{point.year}년</button></th><td>{point.count}건</td><td>{point.cumulative}건</td></tr>)}</tbody></table></div>}
      </section>
      <section className="growth-card field-chart" aria-label="분야별 이력 분포">
        <header className="growth-card-heading"><h3>활동 분야</h3><span>{allCategories.length}개 분야</span></header>
        <div className="field-chart-main"><div className="field-ring" style={{ background: gradient ? `conic-gradient(${gradient})` : "var(--ui-inset)" }} role="img" aria-label={`전체 이력 ${categoryTotal}건, 분야별 건수는 아래 목록`}><div><strong>{categoryTotal}</strong><span>전체 이력</span></div></div></div>
        <ul className="field-legend">{allCategories.map(item => <li key={item.category}><button onClick={() => onCategory(item.category)}><i style={{ background: item.color }}/><span>{displayLabel(item.category)}</span><strong>{item.count}</strong><small>{Math.round(item.count / categoryTotal * 100)}%</small><ArrowUpRight size={12}/></button></li>)}</ul>
        {!allCategories.length && <p className="growth-empty">등록된 이력이 없습니다.</p>}
      </section>
      <div className="growth-data-note"><span>성장 지도와 흐름은 오늘까지 시작된 이력 기준</span>{model.unknown.length > 0 && <span>연도 미입력 {model.unknown.length}건 제외</span>}{model.future.length > 0 && <span>예정 {model.future.length}건 제외</span>}<span>단위: 기록 건수</span></div>
    </div>}
  </section>;
}
