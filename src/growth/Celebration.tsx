import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { Award, Trophy } from "lucide-react";
import { displayText } from "../display";
import { countAt, INTRO_TIMELINE, type Achievement } from "./celebration";

const format = (value: number) => value.toLocaleString("ko-KR");

/** Counts up with requestAnimationFrame by writing text directly (no re-renders).
 *  The box keeps the final width from the first frame, so nothing shifts. */
export function CountUp({ value, delay, duration, play }: { value: number; delay: number; duration: number; play: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    if (!play || value <= 0) { element.textContent = format(value); return; }
    let frame = 0; const start = performance.now();
    element.textContent = "0";
    const tick = (now: number) => {
      const elapsed = now - start;
      element.textContent = format(countAt(value, elapsed, delay, duration));
      if (elapsed < delay + duration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, delay, duration, play]);
  return <span ref={ref} className="count-up" aria-hidden="true" style={{ minWidth: `${format(value).length}ch` }}>{format(value)}</span>;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; star: boolean }
/** One-shot sparkle burst on a canvas laid over the map. Stops itself. */
export function Burst({ fire, x, y }: { fire: boolean; x: number; y: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, context = canvas?.getContext("2d");
    if (!fire || !canvas || !context) return;
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue("--ui-accent").trim() || "#23b494";
    const ink = style.getPropertyValue("--ui-accent-ink").trim() || accent;
    const palette = [accent, accent, ink, "#f6c453", "#ffd98a", "#ffffff"];
    const ox = rect.width * x / 100, oy = rect.height * y / 100;
    const particles: Particle[] = Array.from({ length: 96 }, (_, index) => {
      const angle = Math.random() * Math.PI * 2, speed = 2.2 + Math.random() * 6.4;
      const max = 46 + Math.random() * 44;
      return { x: ox, y: oy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.6, life: 0, max,
        size: 1.4 + Math.random() * 3.2, color: palette[index % palette.length], star: index % 3 === 0 };
    });
    let frame = 0, ring = 0, stopped = false;
    const star = (px: number, py: number, r: number) => {
      context.beginPath();
      for (let i = 0; i < 8; i++) { const radius = i % 2 ? r * .38 : r * 1.6, a = i * Math.PI / 4; context.lineTo(px + Math.cos(a) * radius, py + Math.sin(a) * radius); }
      context.closePath(); context.fill();
    };
    const draw = () => {
      if (stopped) return;
      context.clearRect(0, 0, rect.width, rect.height);
      ring += 1;
      if (ring < 40) {
        context.globalAlpha = Math.max(0, 1 - ring / 40) * .55;
        context.strokeStyle = accent; context.lineWidth = 2.5 * (1 - ring / 40) + .5;
        context.beginPath(); context.arc(ox, oy, 18 + ring * 3.4, 0, Math.PI * 2); context.stroke();
      }
      let alive = 0;
      for (const p of particles) {
        if (p.life >= p.max) continue;
        alive++; p.life++; p.vx *= .965; p.vy = p.vy * .965 + .07; p.x += p.vx; p.y += p.vy;
        const fade = 1 - p.life / p.max;
        context.globalAlpha = Math.min(1, fade * 1.4); context.fillStyle = p.color;
        if (p.star) star(p.x, p.y, p.size * (0.6 + fade * .6));
        else { context.beginPath(); context.arc(p.x, p.y, p.size * fade + .4, 0, Math.PI * 2); context.fill(); }
      }
      context.globalAlpha = 1;
      if (alive || ring < 40) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, rect.width, rect.height);
    };
    frame = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(frame); context.clearRect(0, 0, canvas.width, canvas.height); };
  }, [fire, x, y]);
  return <canvas ref={ref} className="atlas-burst" aria-hidden="true"/>;
}

export function AchievementReel({ items, play, onOpen }: { items: Achievement[]; play: boolean; onOpen?: (ref: string) => void }) {
  if (!items.length) return null;
  return <div className={`atlas-reel ${play ? "is-playing" : ""}`} aria-label="빛나는 순간">
    <span className="atlas-reel-label"><Trophy size={15} strokeWidth={1.9} aria-hidden="true"/>빛나는 순간</span>
    <ul>
      {items.map((item, index) => <li key={item.id} style={{ "--reel-delay": `${INTRO_TIMELINE.reel + index * INTRO_TIMELINE.reelStagger}ms` } as CSSProperties}>
        <button onClick={() => onOpen?.(`career:${item.id}`)} disabled={!onOpen} title={displayText(item.title)} aria-label={`${item.year}년 ${displayText(item.title)}${item.grade ? `, ${item.grade}` : ""} 열기`}>
          <span className="atlas-reel-icon" aria-hidden="true">{item.section === "표창" ? <Award size={16} strokeWidth={1.9}/> : <Trophy size={16} strokeWidth={1.9}/>}</span>
          <span className="atlas-reel-title">{displayText(item.title).replace(/^\s*\d{4}\s*(?:학년도|년)\s+(?=\S)/, "")}</span>
          <span className="atlas-reel-grade"><span className="atlas-reel-year">{item.year}</span>{item.grade && <>, {item.grade}</>}</span>
        </button>
      </li>)}
    </ul>
  </div>;
}
