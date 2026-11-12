import type { Career } from "../types";
import type { PreparedEvidenceImport } from "./evidence-import";
import { approvedEvidenceArchives } from "./evidence-approvals";

/** A URL parameter or a flag inside an imported ZIP cannot grant approval. */
export async function hasEvidenceImportApproval(file: File): Promise<boolean> {
  if (file.size < 1 || file.size > 16 * 1024 * 1024) return false;
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
    byte => byte.toString(16).padStart(2, "0")).join("");
  return approvedEvidenceArchives.includes(fingerprint);
}

const identity = (value: string) => value.normalize("NFC").toLowerCase().replace(/[\s,·ㆍ·⋅]/g, "");

export function sameEvidenceCareer(before: Pick<Career, "id" | "title" | "startDate">, now: Pick<Career, "id" | "title" | "startDate">) {
  return before.id === now.id && Boolean(identity(before.title)) && identity(before.title) === identity(now.title)
    && !(before.startDate && now.startDate && before.startDate.slice(0, 4) !== now.startDate.slice(0, 4));
}

/** This first automatic path attaches evidence to unchanged existing records.
 * New, missing or materially renamed careers still enter ordinary review. */
export function automaticEvidenceLinks(prepared: PreparedEvidenceImport, current: Career[]): Record<string, string[]> | null {
  if (prepared.newCareerIds?.length || !prepared.documents.length) return null;
  const live = new Map(current.map(career => [career.id, career]));
  const archived = new Map(prepared.careers.map(career => [career.id, career]));
  const links: Record<string, string[]> = {};
  for (const document of prepared.documents) {
    if (!document.recordIds.length) return null;
    for (const id of document.recordIds) {
      const before = archived.get(id), now = live.get(id);
      if (!before || !now || !sameEvidenceCareer(before, now)) return null;
    }
    links[document.id] = [...new Set(document.recordIds)];
  }
  return links;
}
