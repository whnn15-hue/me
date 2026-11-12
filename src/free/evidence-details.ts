import type { Career } from "../types";
import { normalizeCareer, validRecordId } from "./normalize";

type Dates = Pick<Career, "startDate" | "endDate" | "datePrecision">;
export interface EvidenceCareerDetails {
  careerId: string;
  sourceDocumentIds: string[];
  organization?: { before: string; after: string };
  title?: { before: string; after: string };
  role?: { before: string; after: string };
  dates?: { before: Dates; after: Dates };
  descriptionReplacements?: { before: string; after: string }[];
  note?: string;
}
const fail = (): never => { throw new Error("증빙의 이력 보완 정보가 올바르지 않습니다."); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object"
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && value === value.trim();
const dateKeys = ["startDate", "endDate", "datePrecision"] as const;
const sameDates = (a: Dates, b: Dates) => dateKeys.every(key => a[key] === b[key]);

/** Optional extension: old archives stay valid. Only source-backed, bounded
 * field corrections and exact description replacements are accepted, never arbitrary fields. */
export function readEvidenceDetails(value: unknown, careers: Career[], documents: { id: string; recordIds: string[] }[]): EvidenceCareerDetails[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > careers.length) return fail();
  const seen = new Set<string>();
  return value.map(raw => {
    if (!object(raw) || !keys(raw, ["careerId", "sourceDocumentIds", "organization", "title", "role", "dates", "descriptionReplacements", "note"])
      || !validRecordId(raw.careerId) || seen.has(raw.careerId)) return fail();
    seen.add(raw.careerId);
    const career = careers.find(item => item.id === raw.careerId);
    if (!career || !Array.isArray(raw.sourceDocumentIds) || !raw.sourceDocumentIds.length
      || raw.sourceDocumentIds.length > documents.length || new Set(raw.sourceDocumentIds).size !== raw.sourceDocumentIds.length
      || raw.sourceDocumentIds.some(id => !validRecordId(id) || !documents.some(doc => doc.id === id && doc.recordIds.includes(career.id)))) return fail();
    const result: EvidenceCareerDetails = { careerId: career.id, sourceDocumentIds: [...raw.sourceDocumentIds] };
    for (const field of ["organization", "title", "role"] as const) if (raw[field] !== undefined) {
      const pair = raw[field];
      if (!object(pair) || !keys(pair, ["before", "after"]) || !text(pair.before, 300) || !text(pair.after, 300)
        || !pair.after || pair.before !== career[field]) return fail();
      result[field] = { before: pair.before, after: pair.after };
    }
    if (raw.dates !== undefined) {
      const pair = raw.dates;
      if (!object(pair) || !keys(pair, ["before", "after"])) return fail();
      const dates = (value: unknown): Dates => {
        if (!object(value) || !keys(value, [...dateKeys]) || !dateKeys.every(key => text(value[key], 10))) return fail();
        const normalized = normalizeCareer(value, career);
        const precisionLength = { year: 4, month: 7, day: 10 }[normalized.datePrecision];
        if (dateKeys.some(key => normalized[key] !== value[key])
          || [normalized.startDate, normalized.endDate].some(date => date && date.length !== precisionLength)) return fail();
        return { startDate: normalized.startDate, endDate: normalized.endDate, datePrecision: normalized.datePrecision };
      };
      result.dates = { before: dates(pair.before), after: dates(pair.after) };
      if (!sameDates(result.dates.before, career) || !result.dates.after.startDate) return fail();
    }
    if (raw.note !== undefined) {
      if (!text(raw.note, 2000) || !raw.note) return fail();
      result.note = raw.note;
    }
    if (raw.descriptionReplacements !== undefined) {
      const replacements = raw.descriptionReplacements;
      if (!Array.isArray(replacements) || !replacements.length || replacements.length > 8) return fail();
      result.descriptionReplacements = replacements.map(pair => {
        if (!object(pair) || !keys(pair, ["before", "after"]) || !text(pair.before, 10000)
          || !pair.before || !text(pair.after, 10000) || pair.after.includes(pair.before)) return fail();
        return { before: pair.before, after: pair.after };
      });
      if (result.descriptionReplacements.some((pair, index, all) => all.some((other, i) => i !== index
        && (pair.before.includes(other.before) || pair.after.includes(other.before))))) return fail();
    }
    if (!result.organization && !result.title && !result.role && !result.dates && !result.note && !result.descriptionReplacements) return fail();
    return result;
  });
}

/** Compare against the fresh snapshot. Never overwrite an intervening owner
 * edit, truncate their notes, or apply half of a date range. Replays are no-ops. */
export function applyEvidenceDetails(career: Career, details: EvidenceCareerDetails): { career: Career; skipped: boolean } {
  const patch: Partial<Career> = {};
  let skipped = false;
  for (const field of ["organization", "title", "role"] as const) {
    const change = details[field];
    if (!change || career[field] === change.after) continue;
    if (career[field] === change.before || field !== "title" && !career[field]) patch[field] = change.after;
    else skipped = true;
  }
  if (details.dates && !sameDates(career, details.dates.after)) {
    if (sameDates(career, details.dates.before) || !career.startDate && !career.endDate) Object.assign(patch, details.dates.after);
    else skipped = true;
  }
  let description = career.description;
  for (const replacement of details.descriptionReplacements ?? []) {
    const first = description.indexOf(replacement.before);
    if (first < 0) {
      if (replacement.after && !description.includes(replacement.after)) skipped = true;
      continue;
    }
    // An ambiguous repeated fragment is not an instruction to delete all matches.
    if (description.indexOf(replacement.before, first + replacement.before.length) >= 0) { skipped = true; continue; }
    description = description.slice(0, first) + replacement.after + description.slice(first + replacement.before.length);
  }
  description = description.trim();
  if (description !== career.description) {
    if (description.length <= 10000) patch.description = description;
    else { description = career.description; skipped = true; }
  }
  if (details.note) {
    const note = `[증빙 기록]\n${details.note}`;
    if (!description.includes(note)) {
      const withNote = [description, note].filter(Boolean).join("\n\n");
      if (withNote.length <= 10000) patch.description = withNote;
      else skipped = true;
    }
  }
  return { career: Object.keys(patch).length ? normalizeCareer(patch, career) : career, skipped };
}
