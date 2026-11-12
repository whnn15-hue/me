import type { Career } from "../types";
import type { PreparedEvidenceImport } from "./evidence-import";
import { approvedEvidenceArchives, approvedEvidenceNewCareerArchives, approvedEvidenceDetailArchives } from "./evidence-approvals";

/** A URL parameter or a flag inside an imported ZIP cannot grant approval. */
export async function evidenceImportApproval(file: File): Promise<{ allowNewCareers: boolean; allowCareerDetails: boolean } | null> {
  if (file.size < 1 || file.size > 16 * 1024 * 1024) return null;
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
    byte => byte.toString(16).padStart(2, "0")).join("");
  const allowNewCareers = approvedEvidenceNewCareerArchives.includes(fingerprint);
  const allowCareerDetails = approvedEvidenceDetailArchives.includes(fingerprint);
  return allowNewCareers || allowCareerDetails || approvedEvidenceArchives.includes(fingerprint) ? { allowNewCareers, allowCareerDetails } : null;
}

export async function hasEvidenceImportApproval(file: File): Promise<boolean> {
  return await evidenceImportApproval(file) !== null;
}

const identity = (value: string) => value.normalize("NFC").toLowerCase().replace(/[\s,·ㆍ·⋅]/g, "");

export function sameEvidenceCareer(before: Pick<Career, "id" | "title" | "startDate">, now: Pick<Career, "id" | "title" | "startDate">) {
  return before.id === now.id && Boolean(identity(before.title)) && identity(before.title) === identity(now.title)
    && !(before.startDate && now.startDate && before.startDate.slice(0, 4) !== now.startDate.slice(0, 4));
}

/** Match precise dates when present so recurring lectures are not merged. */
function sameNewCareer(before: Career, now: Career) {
  const a = before.startDate, b = now.startDate;
  return Boolean(a && b && identity(before.organization))
    && identity(before.title) === identity(now.title)
    && identity(before.organization) === identity(now.organization)
    && (a === b || a.length < b.length && b.startsWith(a + "-") || b.length < a.length && a.startsWith(b + "-"));
}

export interface AutomaticEvidencePlan { links: Record<string, string[]>; newCareerIds: string[] }

/** Only separately approved new proposals may be created. Matching itself never
 * changes fields; exact semantic matches reuse their current IDs. */
export function automaticEvidencePlan(prepared: PreparedEvidenceImport, current: Career[], allowNewCareers = false): AutomaticEvidencePlan | null {
  const proposed = new Set(prepared.newCareerIds ?? []);
  if ((!allowNewCareers && proposed.size) || !prepared.documents.length) return null;
  const live = new Map(current.map(career => [career.id, career]));
  const archived = new Map(prepared.careers.map(career => [career.id, career]));
  const links: Record<string, string[]> = {};
  const creating = new Set<string>();
  for (const document of prepared.documents) {
    if (!document.recordIds.length) return null;
    const targets: string[] = [];
    for (const id of document.recordIds) {
      const before = archived.get(id), now = live.get(id);
      if (!before) return null;
      if (now) {
        if (!sameEvidenceCareer(before, now)) return null;
        targets.push(now.id);
      } else if (proposed.has(id) && allowNewCareers) {
        const matches = current.filter(candidate => sameNewCareer(before, candidate));
        if (matches.length > 1) return null;
        if (matches.length) targets.push(matches[0].id);
        else { creating.add(id); targets.push(id); }
      } else return null;
    }
    links[document.id] = [...new Set(targets)];
  }
  return { links, newCareerIds: [...creating] };
}

export function automaticEvidenceLinks(prepared: PreparedEvidenceImport, current: Career[]): Record<string, string[]> | null {
  return automaticEvidencePlan(prepared, current)?.links ?? null;
}
