import type { Career, DocumentRecord } from "./types";
import { displayText } from "./display";

export const searchText = (text: string) => displayText(text).normalize("NFC").toLocaleLowerCase().trim();
export const searchWords = (query: string) => searchText(query).split(/\s+/).filter(Boolean);
export const matchesWords = (text: string, query: string) => searchWords(query).every(word => searchText(text).includes(word));

export function careerEvidenceState(career: Career, documents: DocumentRecord[]): Career["evidenceStatus"] {
  if (career.documentIds.some(id => documents.some(document => document.id === id))) return "attached";
  return career.evidenceStatus === "unneeded" || career.evidenceStatus === "unavailable" ? career.evidenceStatus : "later";
}

export function matchesEvidenceFilter(career: Career, documents: DocumentRecord[], filter: string) {
  const state = careerEvidenceState(career, documents);
  return filter === "전체 증빙" || (filter === "증빙 있음" ? state === "attached"
    : filter === "증빙 확보 어려움" ? state === "unavailable"
    : filter === "증빙 불필요" ? state === "unneeded" : state === "later");
}

/** Prefer a title match, then metadata, then full text. Keep source order for ties. */
export function rankSearch<T extends { title: string; body: string; detail: string }>(entries: T[], query: string): T[] {
  const phrase = searchText(query), words = searchWords(query);
  if (!words.length) return entries;
  return entries.filter(entry => matchesWords(`${entry.title} ${entry.detail} ${entry.body}`, query))
    .map((entry, index) => {
      const title = searchText(entry.title), detail = searchText(entry.detail);
      const score = (title === phrase ? 1000 : title.startsWith(phrase) ? 500 : title.includes(phrase) ? 300 : 0)
        + words.reduce((sum, word) => sum + (title.includes(word) ? 40 : detail.includes(word) ? 10 : 1), 0);
      return { entry, score, index };
    }).sort((a, b) => b.score - a.score || a.index - b.index).map(row => row.entry);
}

export function archiveAttention(careers: Career[], documents: DocumentRecord[]) {
  const linked = new Set(careers.flatMap(item => item.documentIds));
  return {
    missing: careers.filter(item => careerEvidenceState(item, documents) === "later"),
    undated: careers.filter(item => !item.startDate),
    unlinked: documents.filter(item => !linked.has(item.id)),
  };
}

export function documentFormat(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase() || "";
  if (["hwp", "hwpx", "doc", "docx", "txt"].includes(extension)) return "문서";
  if (["xls", "xlsx", "cell", "csv"].includes(extension)) return "스프레드시트";
  if (["ppt", "pptx"].includes(extension)) return "프레젠테이션";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "이미지";
  if (extension === "pdf") return "PDF";
  if (["html", "htm"].includes(extension)) return "HTML";
  return "기타";
}

export function sortDocuments(documents: DocumentRecord[], order: string) {
  return [...documents].sort((a, b) => (order === "name" ? a.name.localeCompare(b.name, "ko")
    : order === "size" ? b.size - a.size : b.createdAt.localeCompare(a.createdAt)) || a.id.localeCompare(b.id));
}
