import { careerSection, recognitionDetails } from "../../shared/career-organization.mjs";
import type { Career, DocumentRecord } from "../types";
import type { growthModel } from "./growth-model";

/** Sections counted as achievements in the home celebration. */
export const ACHIEVEMENT_SECTIONS = ["표창", "공모전 수상", "연구대회"] as const;
export const INTRO_STORAGE_KEY = "c-archive-home-intro-v1";
/** Beat timings (ms) shared by the CSS delays and the JS counters/particles. */
export const INTRO_TIMELINE = { counters: 180, counterDuration: 1500, counterStagger: 120, trail: 150, trailDuration: 1900, burst: 2050, reel: 2350, reelStagger: 110, done: 4100 } as const;

type Model = ReturnType<typeof growthModel>;

/** Factual headline numbers; nothing is estimated or invented. */
export function celebrationStats(model: Model, documents: DocumentRecord[]) {
  const years = new Set(model.dated.map(entry => entry.year));
  const first = years.size ? Math.min(...years) : null;
  const achievements = model.dated.filter(entry => (ACHIEVEMENT_SECTIONS as readonly string[]).includes(careerSection(entry.career, documents))).length;
  return { total: model.total, years: years.size, institutions: model.organizations, achievements, first };
}

export interface Achievement { id: string; title: string; year: number; section: string; grade: string; organization: string }
/** A random selection (owner request) of at most `max` award/competition records that
 *  have already started, shown newest first. `random` is injectable for tests. */
export function pickAchievements(careers: Career[], documents: DocumentRecord[], today: string, max = 3, random: () => number = Math.random): Achievement[] {
  const eligible = careers
    .filter(career => /^\d{4}/.test(career.startDate) && career.startDate <= today)
    .map(career => ({ career, section: careerSection(career, documents) as string }))
    .filter(entry => (ACHIEVEMENT_SECTIONS as readonly string[]).includes(entry.section));
  // Fisher–Yates shuffle, then keep the chosen few in date order so the reel reads naturally.
  for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  return eligible.slice(0, Math.max(0, max))
    .sort((a, b) => b.career.startDate.localeCompare(a.career.startDate) || a.career.title.localeCompare(b.career.title, "ko"))
    .map(({ career, section }) => ({ id: career.id, title: career.title, year: Number(career.startDate.slice(0, 4)), section,
      grade: String(recognitionDetails(career).grade || "").trim(), organization: career.organization || "" }));
}

/** Korean headline built only from real totals. */
export function celebrationHeadline(stats: ReturnType<typeof celebrationStats>) {
  if (!stats.total || stats.first === null) return { title: "첫 발자취를 기다리고 있어요", sub: "기록을 더하면 이곳에 성장의 길이 그려집니다." };
  const sub = [`${stats.years}개의 해`, stats.institutions ? `${stats.institutions}곳의 기관` : "", stats.achievements ? `${stats.achievements}번의 수상과 성과` : ""].filter(Boolean).join(", ");
  return { title: `${stats.first}년부터 쌓아 온 나의 발자취`, sub: `${sub}${subjectParticle(sub)} 지금의 나를 만들었어요.` };
}

/** 이/가 by the final syllable's batchim (a final digit is read in Korean). */
export function subjectParticle(word: string) {
  const last = word.trim().at(-1) || "";
  const index = "0123456789".indexOf(last);
  const syllable = index >= 0 ? "영일이삼사오육칠팔구"[index] : last;
  const code = syllable.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "이(가)";
  return code % 28 ? "이" : "가";
}

interface Gate { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** The intro plays once per browser session unless motion is reduced. */
export function shouldPlayIntro(storage: Gate | null | undefined, reducedMotion: boolean, hasRecords: boolean) {
  if (reducedMotion || !hasRecords) return false;
  try { return storage?.getItem(INTRO_STORAGE_KEY) !== "played"; } catch { return true; }
}
export function markIntroPlayed(storage: Gate | null | undefined) {
  try { storage?.setItem(INTRO_STORAGE_KEY, "played"); } catch { /* A private window may refuse storage; the intro just plays again. */ }
}

/** easeOutExpo, clamped to [0, 1]. */
export function easeOut(progress: number) {
  const t = Math.min(1, Math.max(0, progress));
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}
/** Integer counter value at `elapsed` ms for a count-up that starts at `delay`. */
export function countAt(target: number, elapsed: number, delay: number, duration: number) {
  if (elapsed <= delay) return 0;
  return Math.round(target * easeOut((elapsed - delay) / Math.max(1, duration)));
}
