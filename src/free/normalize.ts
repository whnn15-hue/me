import { categories, type Career, type DocumentRecord } from "../types";
import {extraFileTypes} from "../../shared/resources.mjs";

export function validRecordId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}
function invalid(message: string): never { throw new Error(message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return invalid("기록 항목은 올바른 객체 형식이어야 합니다.");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (value == null) return "";
  if (typeof value !== "string") return invalid("문자열 항목의 형식이 올바르지 않습니다.");
  return value.trim().slice(0, max);
}
function chosen(input: Record<string, unknown>, previous: Record<string, unknown>, name: string) {
  return input[name] === undefined ? previous[name] : input[name];
}
function date(value: unknown): string {
  const result = text(value, 100);
  if (result && !/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(result)) {
    return invalid("날짜는 YYYY, YYYY-MM 또는 YYYY-MM-DD 형식이어야 합니다.");
  }
  if (result.length === 10) {
    const parsed = new Date(`${result}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) return invalid("실제 존재하는 날짜를 입력해 주세요.");
  }
  return result;
}

/** Keep browser writes and restored data in the same validated shape. */
export function normalizeCareer(value: unknown, previousValue?: Career): Career {
  const input = object(value), previous = previousValue ? object(previousValue) : {};
  const candidate = previous.id ?? input.id;
  const id = candidate === undefined || candidate === "" ? crypto.randomUUID() : candidate;
  if (!validRecordId(id)) return invalid("경력 ID가 올바르지 않습니다.");
  const title = text(chosen(input, previous, "title"), 300);
  if (!title) return invalid("활동명을 입력해 주세요.");
  const category = chosen(input, previous, "category") ?? "기타";
  if (!categories.includes(category as Career["category"])) return invalid("유효하지 않은 경력 분류입니다.");
  const precision = chosen(input, previous, "datePrecision") ?? "day";
  const status = chosen(input, previous, "evidenceStatus") ?? "later";
  const verified = chosen(input, previous, "verified") ?? true;
  if (typeof precision !== "string" || !["year", "month", "day"].includes(precision) || typeof status !== "string" || !["attached", "later", "unneeded"].includes(status) || typeof verified !== "boolean") return invalid("경력 항목 형식이 올바르지 않습니다.");
  const rawTags = chosen(input, previous, "tags") ?? [];
  if (!Array.isArray(rawTags) || rawTags.some(tag => typeof tag !== "string")) return invalid("태그는 문자열 목록이어야 합니다.");
  const rawLinks = chosen(input, previous, "documentIds") ?? [];
  if (!Array.isArray(rawLinks) || rawLinks.length > 1000 || rawLinks.some(id => !validRecordId(id))) return invalid("증빙 파일 연결 목록이 올바르지 않습니다.");
  const documentIds = [...new Set(rawLinks)] as string[];
  const startDate = date(chosen(input, previous, "startDate"));
  const endDate = date(chosen(input, previous, "endDate"));
  if (startDate && endDate && endDate < startDate) return invalid("종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요.");
  const result: Career = {
    id, title, category: category as Career["category"],
    organization: text(chosen(input, previous, "organization"), 300),
    role: text(chosen(input, previous, "role"), 300), startDate, endDate,
    datePrecision: precision as Career["datePrecision"],
    description: text(chosen(input, previous, "description"), 10000),
    tags: [...new Set(rawTags.map(tag => text(tag, 60)).filter(Boolean))].slice(0, 30),
    evidenceStatus: documentIds.length ? "attached" : status === "attached" ? "later" : status as Career["evidenceStatus"],
    verified, documentIds, source: text(chosen(input, previous, "source"), 200),
  };
  for (const field of ["awardLevel", "awardGrade"] as const) {
    const value = chosen(input, previous, field);
    if (value !== undefined) result[field] = text(value, 100);
  }
  const stages = chosen(input, previous, "awardStages");
  if (stages !== undefined) {
    if (!Array.isArray(stages) || stages.length > 10 || stages.some(value => typeof value !== "string" || value.length > 100)) return invalid("대회 단계 목록을 확인해 주세요.");
    result.awardStages = [...new Set(stages.map(value => text(value, 100)).filter(Boolean))];
  }
  return result;
}

export function normalizeDocumentRecord(value: unknown): DocumentRecord {
  const input = object(value);
  if (!validRecordId(input.id)) return invalid("공문 ID가 올바르지 않습니다.");
  const name = text(input.name, 300).replace(/[\/\\\u0000-\u001f]/g, "_");
  if (!name) return invalid("공문 파일명이 필요합니다.");
  if (!/\.(pdf|ppt|pptx|hwp|hwpx|docx|html|htm|txt|xlsx|cell|png|jpg|jpeg|webp)$/i.test(name) && !Object.hasOwn(extraFileTypes,name.split('.').at(-1)?.toLowerCase() || '')) return invalid("지원하는 파일 형식이 아닙니다.");
  const size = input.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > 25 * 1024 * 1024) return invalid("공문 파일은 25MB 이하의 파일이어야 합니다.");
  const createdAt = text(input.createdAt, 50) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) return invalid("공문 등록 시각이 올바르지 않습니다.");
  const hash = input.sha256 == null ? "" : text(input.sha256, 1000);
  if (hash && !/^[a-f0-9]{64}$/.test(hash)) return invalid("공문 원본의 SHA-256 정보가 올바르지 않습니다.");
  const driveFileId = input.driveFileId == null ? "" : text(input.driveFileId, 1000);
  if (driveFileId && !/^[A-Za-z0-9_-]{8,200}$/.test(driveFileId)) return invalid("구글 드라이브 파일 ID가 올바르지 않습니다.");
  const result: DocumentRecord = {
    id: input.id, name, size, mime: text(input.mime, 100) || "application/octet-stream", createdAt,
    text: text(input.text, 24000), analysisStatus: text(input.analysisStatus, 50), recordIds: [],
    ...(hash ? { sha256: hash } : {}), ...(driveFileId ? { driveFileId } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 128 * 1024) return invalid("공문 메타데이터의 크기가 저장 한도를 초과했습니다.");
  return result;
}

export const normalizeFreeCareer = normalizeCareer;
