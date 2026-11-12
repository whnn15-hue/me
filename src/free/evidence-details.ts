import type { Career } from "../types";
import { normalizeCareer, validRecordId } from "./normalize";

type Dates = Pick<Career, "startDate" | "endDate" | "datePrecision">;
export interface EvidenceCareerDetails {
  careerId: string;
  sourceDocumentIds: string[];
  organization?: { before: string; after: string };
  dates?: { before: Dates; after: Dates };
  note?: string;
}
const fail = (): never => { throw new Error("증빙의 기관, 날짜 보완 정보가 올바르지 않습니다."); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object"
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && value === value.trim();
const dateKeys = ["startDate", "endDate", "datePrecision"] as const;
const sameDates = (a: Dates, b: Dates) => dateKeys.every(key => a[key] === b[key]);

/** Optional extension: old archives stay valid. Only source-backed, bounded
 * institution/date changes and an additive note are accepted, never arbitrary fields. */
export function readEvidenceDetails(value: unknown, careers: Career[], documents: { id: string; recordIds: string[] }[]): EvidenceCareerDetails[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > careers.length) return fail();
  const seen = new Set<string>();
  return value.map(raw => {
    if (!object(raw) || !keys(raw, ["careerId", "sourceDocumentIds", "organization", "dates", "note"])
      || !validRecordId(raw.careerId) || seen.has(raw.careerId)) return fail();
    seen.add(raw.careerId);
    const career = careers.find(item => item.id === raw.careerId);
    if (!career || !Array.isArray(raw.sourceDocumentIds) || !raw.sourceDocumentIds.length
      || raw.sourceDocumentIds.length > documents.length || new Set(raw.sourceDocumentIds).size !== raw.sourceDocumentIds.length
      || raw.sourceDocumentIds.some(id => !validRecordId(id) || !documents.some(doc => doc.id === id && doc.recordIds.includes(career.id)))) return fail();
    const result: EvidenceCareerDetails = { careerId: career.id, sourceDocumentIds: [...raw.sourceDocumentIds] };
    if (raw.organization !== undefined) {
      const pair = raw.organization;
      if (!object(pair) || !keys(pair, ["before", "after"]) || !text(pair.before, 300) || !text(pair.after, 300)
        || !pair.after || pair.before !== career.organization) return fail();
      result.organization = { before: pair.before, after: pair.after };
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
    if (!result.organization && !result.dates && !result.note) return fail();
    return result;
  });
}

/** Compare against the fresh snapshot. Never overwrite an intervening owner
 * edit, truncate their notes, or apply half of a date range. Replays are no-ops. */
export function applyEvidenceDetails(career: Career, details: EvidenceCareerDetails): { career: Career; skipped: boolean } {
  const patch: Partial<Career> = {};
  let skipped = false;
  if (details.organization && career.organization !== details.organization.after) {
    if (career.organization === details.organization.before || !career.organization) patch.organization = details.organization.after;
    else skipped = true;
  }
  if (details.dates && !sameDates(career, details.dates.after)) {
    if (sameDates(career, details.dates.before) || !career.startDate && !career.endDate) Object.assign(patch, details.dates.after);
    else skipped = true;
  }
  if (details.note) {
    const note = `[증빙 기록]\n${details.note}`;
    if (!career.description.includes(note)) {
      const description = [career.description, note].filter(Boolean).join("\n\n");
      if (description.length <= 10000) patch.description = description;
      else skipped = true;
    }
  }
  return { career: Object.keys(patch).length ? normalizeCareer(patch, career) : career, skipped };
}
