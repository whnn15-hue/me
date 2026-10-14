import type { Career, DocumentRecord } from "../types";

export type WorkspaceKind = "project" | "material" | "course" | "assignment" | "paper" | "idea";
export interface WorkspaceItemBase {
  id: string; kind: WorkspaceKind; title: string; tags: string[]; createdAt: string; updatedAt: string;
}
export interface ProjectItem extends WorkspaceItemBase {
  kind: "project"; schoolYear: string; grade: string; startDate: string; endDate: string;
  subjects: { subject: string; unit: string }[]; drivingQuestion: string; lessonFlow: string;
  activities: string; tools: string[]; outputs: { label: string; url: string }[];
  photos: { label: string; url: string }[]; reflection: string;
}
export interface MaterialItem extends WorkspaceItemBase {
  kind: "material"; ownership: "created" | "collected"; author: string; eventName: string;
  purpose?: "classroom" | "lecture";
  subjects?: string[];
  trainings?: string[];
  sourceFile?: { name: string; size: number; sha256: string };
  date: string; audience: string[]; format: "PPT" | "PDF" | "HWP" | "TXT" | "영상" | "기타"; fileUrl: string; summary: string;
}
export interface CourseItem extends WorkspaceItemBase { kind: "course"; semester: string; professor: string; }
export interface AssignmentItem extends WorkspaceItemBase {
  kind: "assignment"; courseId: string; dueDate: string;
  status: "planned" | "in-progress" | "submitted"; submissionUrl: string;
}
export interface PaperItem extends WorkspaceItemBase {
  kind: "paper"; authors: string; year: string; summary: string; thoughts: string;
  quotations: { text: string; page: string }[]; courseIds: string[];
}
export interface IdeaItem extends WorkspaceItemBase { kind: "idea"; body: string; }
export type WorkspaceItem = ProjectItem | MaterialItem | CourseItem | AssignmentItem | PaperItem | IdeaItem;
export interface WorkspaceLink { from: string; to: string; }
export interface WorkspaceData { schemaVersion: 1; items: WorkspaceItem[]; links: WorkspaceLink[]; revision: number; }
export interface WorkspaceArchive {
  format: "introduce-me-workspace"; version: 1; createdAt: string;
  careers: Career[]; documents: DocumentRecord[]; workspace: Omit<WorkspaceData, "revision">;
}
export interface WorkspaceImportConflict { ref: string; reason: string; }
export interface WorkspaceImportResult {
  workspace: WorkspaceData; conflicts: WorkspaceImportConflict[];
  added: { careers: number; documents: number; items: number; links: number };
}
export interface WorkspaceSectionProps {
  workspace: WorkspaceData; careers: Career[];
  onSave: (item: WorkspaceItem, links: string[], expectedRevision: number) => Promise<void>;
  onDelete: (id: string, expectedRevision: number) => Promise<void>; onOpen: (ref: string) => void;
  focusId?: string; onError: (error: unknown) => void;
  onFiles?: (files: File[], purpose: "classroom" | "lecture") => Promise<void>;
  uploading?: boolean;
}
// Descriptive aliases keep individual tab code concise.
export type Project = ProjectItem;
export type Material = MaterialItem;
export type Course = CourseItem;
export type Assignment = AssignmentItem;
export type Paper = PaperItem;
export type Idea = IdeaItem;
