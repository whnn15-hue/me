import { useRef, useState } from "react";
import { LayoutGrid, List, Star } from "lucide-react";
import { linkedRefs } from "./WorkspaceUI";
import type { WorkspaceItem, WorkspaceSectionProps } from "./types";

export function useLibraryView(key: string) {
  const [view, setView] = useState<"grid" | "list">(() => {
    try { return localStorage.getItem(`introduce-me-view-${key}`) === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  return [view, (next: "grid" | "list") => { setView(next); try { localStorage.setItem(`introduce-me-view-${key}`, next); } catch { /* View preferences are optional. */ } }] as const;
}
export function ViewSwitch({ view, onChange }: { view: "grid" | "list"; onChange: (value: "grid" | "list") => void }) {
  return <div className="library-view-switch" role="group" aria-label="보기 방식"><button aria-label="갤러리 보기" aria-pressed={view === "grid"} onClick={() => onChange("grid")}><LayoutGrid size={17} /></button><button aria-label="목록 보기" aria-pressed={view === "list"} onClick={() => onChange("list")}><List size={18} /></button></div>;
}
export function useFavorites({ workspace, onSave, onError }: Pick<WorkspaceSectionProps, "workspace" | "onSave" | "onError">) {
  const locked = useRef(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  async function toggle(item: WorkspaceItem) {
    if (locked.current) return;
    locked.current = true; setPending(item.id); setError("");
    try { await onSave({ ...item, favorite: !item.favorite }, linkedRefs(workspace, `${item.kind}:${item.id}`), workspace.revision); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "즐겨찾기를 저장하지 못했습니다."); onError(cause); }
    finally { locked.current = false; setPending(""); }
  }
  return { toggle, pending, error };
}
export function FavoriteButton({ item, pending, onToggle }: { item: WorkspaceItem; pending: string; onToggle: (item: WorkspaceItem) => Promise<void> }) {
  return <button type="button" className="library-favorite" aria-label={`${item.title.replaceAll('·', ',')} 즐겨찾기`} aria-pressed={Boolean(item.favorite)} disabled={Boolean(pending)} onClick={() => void onToggle(item)}><Star size={17} fill={item.favorite ? "currentColor" : "none"} /></button>;
}
