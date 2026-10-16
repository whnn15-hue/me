import { careerCategoryChoices, careerOrganization, careerSection } from "../../shared/career-organization.mjs";
import type { Career, DocumentRecord } from "../types";
import type { WorkspaceData } from "../workspace/types";

export const growthColors = ["#3c9a83", "#8198c2", "#b393ca", "#d7a362", "#6d9fa8", "#ad91a1", "#cb8b75", "#8caa76", "#939d9b"];
export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function fullDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function growthModel(careers: Career[], documents: DocumentRecord[], today: string) {
  const entries = careers.map(career => ({ career, section: careerSection(career, documents), year: /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(career.startDate) ? Number(career.startDate.slice(0, 4)) : 0 }));
  const dated = entries.filter(entry => entry.year > 0 && entry.career.startDate <= today);
  const future = entries.filter(entry => entry.year > 0 && entry.career.startDate > today);
  const unknown = entries.filter(entry => !entry.year);
  const currentYear = Number(today.slice(0, 4));
  const recordedYears = [...new Set(dated.map(entry => entry.year))].sort((a, b) => a - b);
  const firstYear = recordedYears[0] ?? currentYear;
  // Extremely old imported years must not expand the interface without bounds.
  const years = currentYear - firstYear <= 150 ? Array.from({ length: currentYear - firstYear + 1 }, (_, i) => firstYear + i) : [...new Set([...recordedYears, currentYear])];
  let cumulative = 0;
  const series = years.map(year => {
    const records = dated.filter(entry => entry.year === year);
    cumulative += records.length;
    return { year, count: records.length, cumulative, records: records.map(entry => entry.career) };
  });
  const categories = careerCategoryChoices.map((category, index) => ({ category, color: growthColors[index], count: entries.filter(entry => entry.section === category).length })).filter(item => item.count > 0);
  const organizations = new Set(dated.map(entry => careerOrganization(entry.career, documents)).filter(name => name !== "기관 미입력"));
  return { dated, future, unknown, series, categories, organizations: organizations.size, total: dated.length };
}
export interface CalendarEntry { ref: string; title: string; date: string; kind: "career" | "assignment" | "project"; completed: boolean; }
export function calendarEntries(careers: Career[], workspace: WorkspaceData): CalendarEntry[] {
  return [
    ...careers.filter(item => fullDate(item.startDate)).map(item => ({ ref: `career:${item.id}`, title: item.title, date: item.startDate, kind: "career" as const, completed: false })),
    ...workspace.items.flatMap<CalendarEntry>(item => item.kind === "assignment" && fullDate(item.dueDate)
      ? [{ ref: `assignment:${item.id}`, title: item.title, date: item.dueDate, kind: "assignment" as const, completed: item.status === "submitted" }]
      : item.kind === "project" && fullDate(item.startDate)
        ? [{ ref: `project:${item.id}`, title: item.title, date: item.startDate, kind: "project" as const, completed: false }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "ko"));
}
