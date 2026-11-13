import { useState } from "react";
import { LayoutGrid, List } from "lucide-react";

export function useLibraryView(key: string) {
  const [view, setView] = useState<"grid" | "list">(() => {
    try { return localStorage.getItem(`introduce-me-view-v2-${key}`) === "grid" ? "grid" : "list"; } catch { return "list"; }
  });
  return [view, (next: "grid" | "list") => { setView(next); try { localStorage.setItem(`introduce-me-view-v2-${key}`, next); } catch { /* View preferences are optional. */ } }] as const;
}
export function ViewSwitch({ view, onChange }: { view: "grid" | "list"; onChange: (value: "grid" | "list") => void }) {
  return <div className="library-view-switch" role="group" aria-label="보기 방식"><button aria-label="갤러리 보기" aria-pressed={view === "grid"} onClick={() => onChange("grid")}><LayoutGrid size={17} /></button><button aria-label="목록 보기" aria-pressed={view === "list"} onClick={() => onChange("list")}><List size={18} /></button></div>;
}
