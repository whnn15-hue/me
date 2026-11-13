import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Compass, Pause, Play, Sparkles } from "lucide-react";
import { careerCategoryLabel, careerOrganization } from "../../shared/career-organization.mjs";
import type { Career, DocumentRecord } from "../types";
import { displayText } from "../display";
import { growthJourney, growthModel, seoulToday } from "./growth-model";
import { AchievementReel, Burst, CountUp } from "./Celebration";
import { celebrationHeadline, celebrationStats, INTRO_TIMELINE, markIntroPlayed, pickAchievements, pickYearRecord, shouldPlayIntro } from "./celebration";
import { useCareerCarousel } from "./useCareerCarousel";
import "./atlas.css";
import "./celebration.css";
import "./carousel.css";
import "./command-deck.css";

const prefersReducedMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const session = () => { try { return window.sessionStorage; } catch { return null; } };

interface Props {
  careers: Career[]; documents: DocumentRecord[];
  /** Opens the career list for the year in which a record started. */
  onYear?: (year: number) => void;
  today?: string; onShowCareers?: () => void;
  /** Opens a record by reference (e.g. `career:<id>`), used by the achievement reel. */
  onOpen?: (ref: string) => void;
}
function smoothPath(points: { x: number; y: number }[]) {
  return points.map((point, i) => !i ? `M${point.x},${point.y}` : `C${(points[i - 1].x + point.x) / 2},${points[i - 1].y} ${(points[i - 1].x + point.x) / 2},${point.y} ${point.x},${point.y}`).join(" ");
}

export default function GrowthOverview({ careers, documents, onYear, onShowCareers, onOpen, today = seoulToday() }: Props) {
  const model = useMemo(() => growthModel(careers, documents, today), [careers, documents, today]);
  const journey = useMemo(() => growthJourney(model, today), [model, today]);
  const [bannerHovered, setBannerHovered] = useState(false);
  const [bannerFocused, setBannerFocused] = useState(false);
  const [yearHovered, setYearHovered] = useState(false);
  const [yearFocused, setYearFocused] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const previewIds = useRef<Record<number, string>>({});
  const hoveredYear = useRef<number | null>(null);
  const id = useId().replaceAll(":", "");
  const { points: visible, latest, earlier } = journey;
  const carouselRecords = useMemo(() => [...model.dated, ...model.unknown].map(entry => entry.career), [model]);
  const carousel = useCareerCarousel(carouselRecords, true, bannerHovered || bannerFocused || yearHovered || yearFocused);
  const milestone = carousel.record;
  const selectedYear = model.dated.find(entry => entry.career.id === milestone?.id)?.year ?? null;
  const milestoneOrganization = milestone ? careerOrganization(milestone, documents) : "";
  const hasMilestone = Boolean(milestone);
  useEffect(() => {
    if (hasMilestone) return;
    setBannerHovered(false); setBannerFocused(false);
    setYearHovered(false); setYearFocused(false); hoveredYear.current = null;
  }, [hasMilestone]);
  function previewYear(year: number) {
    const point = visible.find(item => item.year === year);
    if (!point?.records.length) return;
    const next = pickYearRecord(point.records, selectedYear === year ? milestone?.id : previewIds.current[year])!;
    previewIds.current[year] = next.id;
    carousel.select(next.id);
  }
  const hasVisibleRecords = visible.some(point => point.count > 0);
  // Every year stays visible. Height is the cumulative actual record count;
  // zero-record years stay on the same level instead of inventing growth.
  const baseline = earlier.reduce((sum, point) => sum + point.count, 0), high = visible.at(-1)?.cumulative ?? 0;
  const pins = visible.map((point, i) => ({ ...point,
    x: visible.length === 1 ? 50 : 7 + i * 86 / (visible.length - 1),
    y: !hasVisibleRecords ? 68 : visible.length === 1 ? 48 : 72 - ((point.cumulative - baseline) / Math.max(1, high - baseline)) * 49,
  }));
  const stats = useMemo(() => celebrationStats(model, documents), [model, documents]);
  const headline = celebrationHeadline(stats);
  // A fresh random three each time home opens.
  const achievements = useMemo(() => pickAchievements(careers, documents, today), [careers, documents, today]);
  const latestPin = pins.find(point => point.year === latest) ?? pins.at(-1);
  // Once-per-session celebration; reduced motion always shows the final state.
  const [playing, setPlaying] = useState(() => shouldPlayIntro(session(), prefersReducedMotion(), hasVisibleRecords));
  const [burst, setBurst] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // A changed slide can remove the focused title without dispatching blur.
    const focused = document.activeElement;
    setBannerFocused(Boolean(focused?.matches(":focus-visible") && bannerRef.current?.contains(focused)));
    setYearFocused(Boolean(rootRef.current?.querySelector(".atlas-pin:focus-visible")));
  }, [milestone?.id, model]);
  const finish = useCallback(() => {
    setPlaying(false); setBurst(false);
    // Jump every running CSS animation to its end state instead of removing it.
    rootRef.current?.getAnimations({ subtree: true }).forEach(animation => { try { animation.finish(); } catch { /* Infinite or idle animations stay as they are. */ } });
  }, []);
  useEffect(() => {
    if (!playing) return;
    markIntroPlayed(session());
    const timers = [window.setTimeout(() => setBurst(true), INTRO_TIMELINE.burst), window.setTimeout(() => { setPlaying(false); setBurst(false); }, INTRO_TIMELINE.done)];
    const skip = () => finish();
    const hidden = () => { if (document.hidden) finish(); };
    window.addEventListener("keydown", skip); window.addEventListener("pointerdown", skip); document.addEventListener("visibilitychange", hidden);
    return () => { timers.forEach(window.clearTimeout); window.removeEventListener("keydown", skip); window.removeEventListener("pointerdown", skip); document.removeEventListener("visibilitychange", hidden); };
  }, [playing, finish]);
  const counters = [
    { label: "쌓아 온 이력", value: stats.total, unit: "건" },
    { label: "활동한 해", value: stats.years, unit: "년" },
    ...(stats.institutions ? [{ label: "함께한 기관", value: stats.institutions, unit: "곳" }] : []),
    ...(stats.achievements ? [{ label: "수상과 성과", value: stats.achievements, unit: "건" }] : []),
  ];
  const route = smoothPath(pins.map(point => ({ x: point.x * 10, y: point.y * 4 })));
  const area = pins.length > 1 ? `${route} L${pins.at(-1)!.x * 10},400 L${pins[0].x * 10},400 Z` : "";
  return <section ref={rootRef} className={`growth-overview growth-atlas atlas-primary ${playing ? "is-celebrating" : ""}`} aria-label="나의 성장">
    <section className={`atlas-panel ${hasVisibleRecords ? "has-hero" : ""}`} id={`${id}-panels`} aria-label="연도별 성장 지도">
      {hasVisibleRecords ? <div className="atlas-hero">
        <div className="atlas-hero-glow" aria-hidden="true"/>
        <div className="atlas-hero-copy">
          <span className="atlas-range">{visible[0].year}<span>~</span>{visible.at(-1)!.year}<em>모든 해의 발자취</em></span>
          <h3 className="atlas-hero-title">{headline.title}</h3>
          <p>{headline.sub}</p>
        </div>
        <dl className="atlas-hero-stats" style={{ "--stat-count": counters.length } as CSSProperties}>
          {counters.map((counter, index) => <div key={counter.label} style={{ "--stat-delay": `${INTRO_TIMELINE.counters + index * INTRO_TIMELINE.counterStagger}ms` } as CSSProperties}>
            <dt>{counter.label}</dt>
            <dd><CountUp value={counter.value} play={playing} delay={INTRO_TIMELINE.counters + index * INTRO_TIMELINE.counterStagger} duration={INTRO_TIMELINE.counterDuration}/><span className="visually-hidden">{counter.value.toLocaleString("ko-KR")}</span><small>{counter.unit}</small></dd>
          </div>)}
        </dl>
      </div> : <div className="atlas-panel-top">
        <span className="atlas-range">{visible[0].year}<span>~</span>{visible.at(-1)!.year}</span>
        <span className="atlas-entire-range">모든 해의 발자취</span>
      </div>}
      <div className="atlas-stage">
      {milestone && <div ref={bannerRef} className="atlas-milestone career-carousel" role="region" aria-roledescription="슬라이드"
        aria-label={selectedYear ? `${selectedYear}년 기록 미리보기` : "이력 미리보기"}
        data-direction={carousel.direction} data-running={carousel.running}
        onMouseEnter={() => setBannerHovered(true)} onMouseLeave={() => setBannerHovered(false)}
        onPointerDownCapture={() => setBannerFocused(false)} onKeyDownCapture={() => setBannerFocused(true)}
        onFocusCapture={event => setBannerFocused(event.target.matches(":focus-visible"))}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBannerFocused(false); }}>
        <div className="career-carousel-content" aria-live={carousel.running ? "off" : "polite"} aria-atomic="true">
          <div className="career-carousel-slide" key={milestone.id}>
            <div className="career-carousel-meta">{selectedYear && <span>{selectedYear}년</span>}<span>{careerCategoryLabel(milestone, documents)}</span>{milestoneOrganization && milestoneOrganization !== "기관 미입력" && <span className="career-carousel-institution">{displayText(milestoneOrganization)}</span>}</div>
            <button className="atlas-milestone-record" onClick={() => onOpen?.(`career:${milestone.id}`)} disabled={!onOpen}>
              <strong>{displayText(milestone.title)}</strong>
            </button>
          </div>
        </div>
        {carousel.count > 1 && <div className="career-carousel-controls">
          <button aria-label="이전 이력" onClick={() => carousel.step(-1)}><ChevronLeft size={17}/></button>
          <span className="career-carousel-position" aria-label={`전체 ${carousel.count}개 중 ${carousel.index + 1}번째 이력`}>{carousel.index + 1} / {carousel.count}</span>
          <button aria-label="다음 이력" onClick={() => carousel.step(1)}><ChevronRight size={17}/></button>
          <button aria-label={carousel.wantsPlayback ? "이력 자동 넘김 일시정지" : "이력 자동 넘김 재생"} title={carousel.wantsPlayback ? "자동 넘김 일시정지" : "자동 넘김 재생"} onClick={carousel.togglePlayback}>{carousel.wantsPlayback ? <Pause size={14}/> : <Play size={14}/>}</button>
        </div>}
      </div>}
      <div className="atlas-canvas">
        <div className="atlas-horizon" aria-hidden="true"/>
        <svg className="atlas-contours" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
          {[0,1,2,3,4].map(index => <path key={index} d={`M-100,${300 + index * 38} C120,${180 + index * 38} 220,${415 + index * 32} 450,${305 + index * 32} S760,${115 + index * 34} 1110,${165 + index * 38}`}/>)}
        </svg>
        <span className="atlas-watermark" aria-hidden="true">{visible.at(-1)?.year}</span>
        {hasVisibleRecords && latestPin && <Burst fire={burst} x={latestPin.x} y={latestPin.y}/>}
        {pins.length > 1 && <svg className={`atlas-route ${hasVisibleRecords ? "" : "is-empty"}`} viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-trail`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="var(--ui-accent-line)"/><stop offset=".55" stopColor="var(--ui-accent)"/><stop offset="1" stopColor="var(--ui-accent-ink)"/></linearGradient>
            {/* The trail is revealed with a clip that grows across the whole viewBox, so it
                always reaches the latest year whatever the rendered width. A dash-offset reveal
                stopped short: with non-scaling strokes the dash is measured in screen pixels,
                which exceed the 1000-unit pathLength on wide screens. */}
            <clipPath id={`${id}-reveal`} clipPathUnits="userSpaceOnUse"><rect className="atlas-reveal" x="-20" y="-40" width="1040" height="480"/></clipPath>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--ui-accent)" stopOpacity=".14"/><stop offset="1" stopColor="var(--ui-accent)" stopOpacity="0"/></linearGradient>
          </defs>
          {hasVisibleRecords && <path className="atlas-area" d={area} fill={`url(#${id}-area)`}/>}
          <path className="atlas-trail-base" d={route}/>
          {hasVisibleRecords && <><g clipPath={`url(#${id}-reveal)`}><path className="atlas-trail-glow" d={route} stroke={`url(#${id}-trail)`}/><path className="atlas-trail" d={route} stroke={`url(#${id}-trail)`}/></g><circle className="atlas-traveler" r="3.5" fill="var(--ui-accent)"><animateMotion dur="2.4s" begin=".15s" repeatCount="1" path={route} fill="freeze"/></circle></>}
        </svg>}
        {pins.map((point, index) => <button key={point.year} className={`atlas-pin ${latest === point.year ? "is-latest" : ""} ${!point.count ? "is-empty" : ""} ${selectedYear === point.year ? "is-selected" : ""}`} style={{ left:`${point.x}%`, top:`${point.y}%`, "--pin-delay":`${.18 + index / Math.max(1,pins.length-1) * 1.6}s` } as CSSProperties} aria-label={`${point.year}년 이력 보기, 이 해에 시작한 기록 ${point.count}건`} title={point.count ? `${point.year}년까지 누적 ${point.cumulative}건` : `${point.year}년 기록 없음`} disabled={!point.count} onMouseEnter={() => { hoveredYear.current = point.year; setYearHovered(true); previewYear(point.year); }} onMouseLeave={() => { hoveredYear.current = null; setYearHovered(false); }} onPointerDown={() => setYearFocused(false)} onKeyDown={() => setYearFocused(true)} onFocus={event => { setYearFocused(event.target.matches(":focus-visible")); if (hoveredYear.current !== point.year) previewYear(point.year); }} onBlur={() => setYearFocused(false)} onClick={() => onYear?.(point.year)}>
          <span className="atlas-pin-orbit" aria-hidden="true"/><span className="atlas-pin-core" aria-hidden="true">{latest === point.year ? <Sparkles size={18} strokeWidth={1.8}/> : <i/>}</span>
          <span className="atlas-pin-label"><strong>{point.year}</strong><small>{point.count ? <span><CountUp value={point.count} play={playing} delay={Math.round((.18 + index / Math.max(1,pins.length-1) * 1.6) * 1000) + 120} duration={650}/>개 기록</span> : "기록 없음"}<ArrowUpRight size={12}/></small></span>
          {latest === point.year && <span className="atlas-present">최근의 발자취</span>}
        </button>)}
        {!hasVisibleRecords && <div className="atlas-empty"><Compass size={32} strokeWidth={1.2}/><h3>{earlier.length ? "이곳에 다음 발자취를 이어 보세요" : "첫 발자취를 기다리고 있어요"}</h3>{onShowCareers && <button onClick={onShowCareers}>이력 열기<ArrowUpRight size={15}/></button>}</div>}
      </div>
      </div>
      {hasVisibleRecords && <AchievementReel items={achievements} play={playing} onOpen={onOpen}/>}
      {earlier.length > 0 && <footer className="atlas-footer">
        <details className="atlas-earlier"><summary>{visible[0].year}년 이전 기록<ChevronDown size={13}/></summary><div>{earlier.map(point=><button key={point.year} onClick={()=>onYear?.(point.year)} aria-label={`${point.year}년 이력 보기, 이 해에 시작한 기록 ${point.count}건`}><strong>{point.year}</strong><span>{point.count}개 기록</span><ArrowUpRight size={13}/></button>)}</div></details>
        {onShowCareers && <button onClick={onShowCareers}>전체 발자취<ArrowUpRight size={15}/></button>}
      </footer>}
    </section>
  </section>;
}
