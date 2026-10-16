import type { Career, DocumentRecord } from "../types";
import type { WorkspaceData } from "../workspace/types";
import { careerOrganization } from "../../shared/career-organization.mjs";

export function isExactDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export interface AgendaEntry { ref: string; title: string; date: string; label: string; detail: string; overdue: boolean; }

export function homeModel(careers: Career[], documents: DocumentRecord[], workspace: WorkspaceData, today: string) {
  const assignments = workspace.items.filter(item => item.kind === "assignment" && item.status !== "submitted");
  const agenda: AgendaEntry[] = careers.filter(item => isExactDate(item.startDate) && item.startDate >= today)
    .map(item => ({ ref: `career:${item.id}`, title: item.title, date: item.startDate, label: "활동", detail: careerOrganization(item, documents), overdue: false }));
  for (const item of assignments) {
    if (item.kind !== "assignment" || !isExactDate(item.dueDate)) continue;
    agenda.push({ ref: `assignment:${item.id}`, title: item.title, date: item.dueDate, label: "과제", detail: workspace.items.find(course => course.kind === "course" && course.id === item.courseId)?.title || "강좌 미지정", overdue: item.dueDate < today });
  }
  agenda.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
  const activeProjects = workspace.items.filter(item => item.kind === "project" && isExactDate(item.startDate) && isExactDate(item.endDate) && item.startDate <= today && item.endDate >= today);
  const recent = workspace.items.filter(item => ["project", "material", "paper", "idea"].includes(item.kind))
    .slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, 5);
  const recentCareers = careers.filter(item => /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(item.startDate) && item.startDate <= today)
    .slice().sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id)).slice(0, 4);
  return { agenda, assignments, activeProjects, recent, recentCareers };
}
