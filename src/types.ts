export const categories = [
  "강의·연수",
  "위원회·지원단",
  "연구·수상",
  "연구대회",
  "표창",
  "집필·콘텐츠",
  "근무·파견",
  "파견",
  "근무",
  "집필",
  "콘텐츠 제작",
  "자격증",
  "기타",
] as const;
export type Category = (typeof categories)[number];
export interface Career {
  id: string;
  title: string;
  category: Category;
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  datePrecision: "year" | "month" | "day";
  description: string;
  tags: string[];
  evidenceStatus: "attached" | "later" | "unneeded";
  verified: boolean;
  documentIds: string[];
  source?: string;
  awardLevel?: string;
  awardGrade?: string;
  awardStages?: string[];
}
export interface DocumentRecord {
  id: string;
  name: string;
  size: number;
  mime: string;
  createdAt: string;
  text?: string;
  recordIds: string[];
  analysisStatus?: string;
  driveFileId?: string;
  sha256?: string;
}
export interface Status {
  mode: "local" | "google" | "firebase";
  deploymentMode?: "free" | "paid" | "local";
  user: { name: string; email: string } | null;
  googleConfigured: boolean;
  firebaseConfigured?: boolean;
  driveConfigured?: boolean;
  aiConfigured: boolean;
  driveConnected: boolean;
  ownerConfigured: boolean;
  lastBackup: string | null;
  backupError?: string;
  configurationError?: string;
  authenticationError?: string;
}
export type View = "careers" | "projects" | "materials" | "graduate" | "documents" | "resume" | "settings";
export interface HwpxField {
  id: string;
  label: string;
  text: string;
  editable?: boolean;
}
export const emptyCareer = (): Career => ({
  id: "",
  title: "",
  category: "기타",
  organization: "",
  role: "",
  startDate: "",
  endDate: "",
  datePrecision: "year",
  description: "",
  tags: [],
  evidenceStatus: "later",
  verified: true,
  documentIds: [],
});
