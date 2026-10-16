import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Career } from "../types";
import type { WorkspaceData } from "../workspace/types";
import { displayLabel } from "../workspace/WorkspaceUI";
import { calendarEntries } from "./growth-model";

export default function RecordCalendar({ careers, workspace, today, onOpen }: { careers: Career[]; workspace: WorkspaceData; today: string; onOpen: (ref: string) => void }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const entries = useMemo(() => calendarEntries(careers, workspace), [careers, workspace]);
  const [year, number] = month.split("-").map(Number);
  const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const monthly = entries.filter(entry => entry.date.startsWith(month));
  const dayEntries = monthly.filter(entry => entry.date === selected);
  const datedDays = new Set(monthly.map(entry => entry.date));
  function move(amount: number) {
    const next = new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0, 7);
    setMonth(next); setSelected(`${next}-01`);
  }
  return <section className="growth-card record-calendar" aria-label="기록 달력">
    <header className="growth-card-heading"><h3><CalendarDays size={16}/>기록 달력</h3><button className="calendar-today" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>오늘</button></header>
    <div className="calendar-month"><strong>{year}년 {number}월</strong><div><button aria-label="이전 달" onClick={() => move(-1)}><ChevronLeft size={16}/></button><button aria-label="다음 달" onClick={() => move(1)}><ChevronRight size={16}/></button></div></div>
    <div className="calendar-week" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="calendar-days" role="group" aria-label={`${year}년 ${number}월 날짜`}>
      {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
      {Array.from({ length: days }, (_, i) => {
        const key = `${month}-${String(i + 1).padStart(2, "0")}`;
        return <button key={key} className={`${selected === key ? "selected" : ""} ${today === key ? "today" : ""}`} aria-pressed={selected === key} aria-current={today === key ? "date" : undefined} aria-label={`${key}${datedDays.has(key) ? ", 기록 있음" : ""}`} onClick={() => setSelected(key)}>{i + 1}{datedDays.has(key) && <i aria-hidden="true"/>}</button>;
      })}
    </div>
    <div className="calendar-day-details" aria-live="polite"><div><span>{Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일</span><small>{dayEntries.length}개 기록</small></div>
      {dayEntries.length ? <ul>{dayEntries.map(entry => <li key={entry.ref}><button onClick={() => onOpen(entry.ref)}><span><small>{entry.kind === "assignment" ? entry.completed ? "제출 완료" : "과제 마감" : entry.kind === "project" ? "수업 시작" : "이력"}</small>{displayLabel(entry.title)}</span><ArrowUpRight size={14}/></button></li>)}</ul> : <p>이 날짜에 등록된 기록이 없습니다.</p>}
    </div>
  </section>;
}
