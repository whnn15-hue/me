import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, Settings } from "lucide-react";
import type { View } from "./types";

const entries = [
  { view: "documents", label: "공문 보관함", icon: FolderOpen },
  { view: "resume", label: "제출 서류 만들기", icon: FileText },
  { view: "settings", label: "백업 및 설정", icon: Settings },
] as const;

export default function ArchiveTools({ onView }: { onView: (view: View) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="archive-tools" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }}>
    <button ref={trigger} className="icon-button archive-tools-trigger" aria-label="보관함과 설정" title="보관함과 설정" aria-haspopup="menu" aria-expanded={open} aria-controls="archive-tools-menu" onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setOpen(true); }
    }}><Settings size={21} aria-hidden="true" /></button>
    {open && <div className="archive-tools-menu" id="archive-tools-menu" role="menu" aria-label="보관함과 설정">{entries.map(entry => <button key={entry.view} role="menuitem" onClick={() => { setOpen(false); onView(entry.view); trigger.current?.focus(); }}><entry.icon size={17} aria-hidden="true" />{entry.label}</button>)}</div>}
  </div>;
}
