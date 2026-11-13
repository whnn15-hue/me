import { useCallback, useEffect, useMemo, useState } from "react";
import type { Career } from "../types";

export const CAREER_SLIDE_INTERVAL = 5000;
const motionQuery = "(prefers-reduced-motion: reduce)";
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia(motionQuery).matches;

/** Presentation state only. A shuffled cycle gives every eligible record a turn. */
export function useCareerCarousel(records: Career[], enabled: boolean, held: boolean) {
  const deck = useMemo(() => {
    const shuffled = [...records];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [records]);
  const [selection, setSelection] = useState({ id: "", revision: 0, direction: "next" });
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [motionOptIn, setMotionOptIn] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const index = Math.max(0, deck.findIndex(record => record.id === selection.id));
  const record = deck[index];
  const wantsPlayback = !paused && (!reduced || motionOptIn);
  const running = enabled && deck.length > 1 && wantsPlayback && !held && !hidden;

  const select = useCallback((id: string) => {
    if (deck.some(record => record.id === id)) {
      setSelection(previous => ({ id, revision: previous.revision + 1, direction: "next" }));
    }
  }, [deck]);
  const step = useCallback((delta: number) => {
    if (deck.length < 2) return;
    setSelection(previous => {
      const current = Math.max(0, deck.findIndex(item => item.id === previous.id));
      return {
        id: deck[(current + delta + deck.length) % deck.length].id,
        revision: previous.revision + 1,
        direction: delta < 0 ? "previous" : "next",
      };
    });
  }, [deck]);

  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    const media = window.matchMedia(motionQuery);
    const motion = () => { setReduced(media.matches); setMotionOptIn(false); };
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", motion);
    return () => { document.removeEventListener("visibilitychange", visibility); media.removeEventListener("change", motion); };
  }, []);
  useEffect(() => {
    if (!running) return;
    // A fresh reading interval after each navigation, pause or tab return.
    const timer = window.setTimeout(() => step(1), CAREER_SLIDE_INTERVAL);
    return () => window.clearTimeout(timer);
  }, [running, step, selection.revision]);

  function togglePlayback() {
    if (wantsPlayback) setPaused(true);
    else { setPaused(false); if (reduced) setMotionOptIn(true); }
  }
  return { record, index, count: deck.length, running, wantsPlayback, select, step, togglePlayback, direction: selection.direction };
}
