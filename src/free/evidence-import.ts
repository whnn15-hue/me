import JSZip from "jszip";
import type { Career, DocumentRecord } from "../types";
import { readBackupFile, type RestoredDocument } from "./backup";
import { sha256, trashDriveFile, uploadDriveFile, validateDriveUploadFile } from "./drive";
import { normalizeCareer, normalizeDocumentRecord, validRecordId } from "./normalize";
import { activateRestoredData, ArchiveRevisionConflictError, readFreeSnapshot } from "./store";

const MAX_METADATA_SIZE = 5 * 1024 * 1024;
const MAX_ORIGINALS_SIZE = 200 * 1024 * 1024;
const MAX_CAREERS = 100_000;
const MAX_DOCUMENTS = 10_000;

/** Carrier careers are labels and suggested links, never replacement records. */
export interface PreparedEvidenceImport {
  format: "career-evidence-import";
  version: 1;
  careers: Career[];
  documents: RestoredDocument[];
}
export interface EvidenceImportProgress {
  phase: "validating" | "uploading" | "saving" | "done";
  completed: number;
  total: number;
  fileName?: string;
}
export interface EvidenceImportOptions {
  /** Every incoming document needs an explicit decision; [] keeps it unlinked. */
  approvedLinks: Record<string, string[]>;
  signal?: AbortSignal;
  onProgress?: (progress: EvidenceImportProgress) => void;
}
export interface EvidenceImportResult {
  added: number;
  duplicates: number;
  linked: number;
  careersUpdated: number;
  unmatched: number;
}

/** Preview labels reflect the owner's current records without changing them. */
export async function readEvidenceImportReviewCareers(): Promise<Career[]> {
  return (await readFreeSnapshot()).careers;
}

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("가져오기를 취소했습니다.", "AbortError");
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}
function metadataSize(careers: Career[], documents: DocumentRecord[]) {
  const encoder = new TextEncoder();
  const links = new Map<string, string[]>();
  for (const career of careers) {
    if (encoder.encode(JSON.stringify(career)).byteLength > 128 * 1024)
      throw new Error("경력 한 건의 메타데이터가 복원 가능한 크기를 초과합니다.");
    for (const id of career.documentIds) {
      const selected = links.get(id) || [];
      selected.push(career.id); links.set(id, selected);
    }
  }
  const metadata = documents.map(document => {
    if (encoder.encode(JSON.stringify({ ...document, recordIds: links.get(document.id) || [] })).byteLength > 128 * 1024)
      throw new Error("공문 한 건의 연결 정보가 복원 가능한 크기를 초과합니다.");
    const { recordIds: _computedLinks, ...stored } = document;
    return stored;
  });
  // Match the pretty-printed automatic Drive snapshot, including its envelope.
  const snapshot = { format: "career-drive-snapshot", version: 1, createdAt: new Date().toISOString(), careers, documents: metadata };
  if (encoder.encode(JSON.stringify(snapshot, null, 2)).byteLength > MAX_METADATA_SIZE)
    throw new Error("가져온 뒤의 경력, 공문 목록이 백업 용량 한도인 5 MB를 초과합니다.");
}

/** Validate the ordinary ZIP/CRC/SHA schema before reading its additive marker. */
export async function readEvidenceImportFile(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<PreparedEvidenceImport> {
  checkCancellation(options.signal);
  const restored = await readBackupFile(file, { allowEvidenceImport: true });
  checkCancellation(options.signal);
  // The same immutable File has already passed bounded inflation and CRC checks.
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("공문 가져오기 목록을 찾을 수 없습니다.");
  const bytes = await manifestFile.async("uint8array");
  if (bytes.byteLength > MAX_METADATA_SIZE) throw new Error("공문 가져오기 목록의 크기 제한을 초과했습니다.");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("공문 가져오기 목록을 읽을 수 없습니다."); }
  const marker = plainObject(raw) ? raw.evidenceImport : undefined;
  if (!plainObject(marker) || marker.format !== "career-evidence-import" || marker.version !== 1)
    throw new Error("검토한 공문을 추가하는 전용 파일을 선택해 주세요. 전체 백업 복원 파일과 다릅니다.");
  if (!restored.documents.length) throw new Error("가져올 공문이 없는 파일입니다.");
  checkCancellation(options.signal);
  return { format: "career-evidence-import", version: 1, careers: restored.careers, documents: restored.documents };
}

/**
 * Merge against a fresh server snapshot. Existing fields and originals survive;
 * only reviewed links and previously unseen SHA-256 originals are added.
 */
export async function applyEvidenceImport(
  prepared: PreparedEvidenceImport,
  options: EvidenceImportOptions,
): Promise<EvidenceImportResult> {
  checkCancellation(options.signal);
  if (!prepared || prepared.format !== "career-evidence-import" || prepared.version !== 1
    || !Array.isArray(prepared.careers) || prepared.careers.length > MAX_CAREERS
    || !Array.isArray(prepared.documents) || !prepared.documents.length || prepared.documents.length > MAX_DOCUMENTS)
    throw new Error("검토할 공문 가져오기 파일이 올바르지 않습니다.");
  if (!plainObject(options.approvedLinks)) throw new Error("공문별 경력 연결을 확인해 주세요.");
  const report = (progress: EvidenceImportProgress) => options.onProgress?.(progress);
  report({ phase: "validating", completed: 0, total: prepared.documents.length });

  const incoming: { document: DocumentRecord & { sha256: string }; file: File; links: string[] }[] = [];
  const incomingIds = new Set<string>(), incomingHashes = new Set<string>();
  let originalSize = 0;
  // Copy bytes before awaits so changes to the preview cannot change uploaded data.
  const copied = prepared.documents.map(item => {
    if (!item || !(item.bytes instanceof Uint8Array)) throw new Error("공문 원본을 읽을 수 없습니다.");
    originalSize += item.bytes.byteLength;
    if (item.bytes.byteLength > 25 * 1024 * 1024 || originalSize > MAX_ORIGINALS_SIZE)
      throw new Error("공문 원본은 각각 25 MB, 한 번에 200 MB 이하여야 합니다.");
    return { ...item, bytes: new Uint8Array(item.bytes) };
  });
  for (const [index, item] of copied.entries()) {
    checkCancellation(options.signal);
    const { bytes, driveFileId: _untrustedDriveReference, recordIds: _suggestedLinks, ...raw } = item;
    const document = normalizeDocumentRecord(raw);
    if (!document.sha256 || incomingIds.has(document.id) || incomingHashes.has(document.sha256))
      throw new Error("중복된 공문 ID 또는 원본이 포함된 가져오기 파일입니다.");
    incomingIds.add(document.id); incomingHashes.add(document.sha256);
    if (bytes.byteLength !== document.size || await sha256(bytes) !== document.sha256)
      throw new Error("공문 원본의 크기, SHA-256 무결성 검증에 실패했습니다.");
    const file = new File([new Uint8Array(bytes).buffer], document.name, { type: document.mime });
    await validateDriveUploadFile(file);
    const links = options.approvedLinks[document.id];
    if (!Object.hasOwn(options.approvedLinks, document.id) || !Array.isArray(links)
      || links.length > MAX_CAREERS || links.some(id => !validRecordId(id)))
      throw new Error("모든 공문의 연결할 경력을 확인하거나 미연결로 선택해 주세요.");
    incoming.push({ document: document as DocumentRecord & { sha256: string }, file, links: [...new Set(links)] });
    report({ phase: "validating", completed: index + 1, total: copied.length, fileName: document.name });
  }
  if (Object.keys(options.approvedLinks).some(id => !incomingIds.has(id)))
    throw new Error("가져오기 목록에 없는 공문의 연결이 포함되어 있습니다.");
  checkCancellation(options.signal);
  const current = await readFreeSnapshot();
  checkCancellation(options.signal);
  const liveCareerIds = new Set(current.careers.map(career => career.id));
  for (const item of incoming) {
    if (item.links.some(id => !liveCareerIds.has(id)))
      throw new Error("연결할 경력이 삭제되거나 변경되었습니다. 최신 경력 목록을 확인한 뒤 다시 시도해 주세요.");
  }
  const byId = new Map(current.documents.map(document => [document.id, document]));
  const byHash = new Map<string, DocumentRecord>();
  for (const document of current.documents) {
    if (!document.sha256 || !document.driveFileId || byHash.has(document.sha256))
      throw new Error("기존 공문의 원본, 중복 정보를 확인한 뒤 다시 시도해 주세요.");
    byHash.set(document.sha256, document);
  }
  const targetIds = new Map<string, string>();
  const newItems: typeof incoming = [];
  for (const item of incoming) {
    const sameId = byId.get(item.document.id);
    if (sameId && sameId.sha256 !== item.document.sha256)
      throw new Error("이미 사용 중인 공문 ID가 다른 원본과 충돌합니다. 가져오기 파일을 확인해 주세요.");
    const duplicate = byHash.get(item.document.sha256);
    targetIds.set(item.document.id, duplicate?.id || item.document.id);
    if (!duplicate) newItems.push(item);
  }
  if (current.careers.length > MAX_CAREERS || current.documents.length + newItems.length > MAX_DOCUMENTS)
    throw new Error("경력 또는 공문 개수가 보관함 한도를 초과합니다.");
  const linksByCareer = new Map<string, Set<string>>();
  for (const item of incoming) {
    const target = targetIds.get(item.document.id)!;
    for (const careerId of item.links) {
      const links = linksByCareer.get(careerId) || new Set<string>();
      links.add(target); linksByCareer.set(careerId, links);
    }
  }
  let linked = 0, careersUpdated = 0;
  const careers = current.careers.map(career => {
    const approved = linksByCareer.get(career.id);
    if (!approved) return career;
    const additions = [...approved].filter(id => !career.documentIds.includes(id));
    if (!additions.length) return career;
    linked += additions.length; careersUpdated++;
    return normalizeCareer({ documentIds: [...career.documentIds, ...additions] }, career);
  });
  const result: EvidenceImportResult = {
    added: newItems.length, duplicates: incoming.length - newItems.length, linked, careersUpdated,
    unmatched: incoming.filter(item => !item.links.length).length,
  };
  const documents = [...current.documents, ...newItems.map(item => item.document)];
  metadataSize(careers, documents);
  if (!result.added && !result.linked) {
    report({ phase: "done", completed: 1, total: 1 });
    return result;
  }

  const uploaded: string[] = [];
  let commitStarted = false;
  try {
    report({ phase: "uploading", completed: 0, total: newItems.length });
    for (const [index, item] of newItems.entries()) {
      checkCancellation(options.signal);
      report({ phase: "uploading", completed: index, total: newItems.length, fileName: item.document.name });
      const stored = await uploadDriveFile(item.file, "document", item.document.sha256);
      uploaded.push(stored.id);
      checkCancellation(options.signal);
      const saved = normalizeDocumentRecord({ ...item.document, driveFileId: stored.id });
      documents[documents.findIndex(document => document.id === item.document.id)] = saved;
      report({ phase: "uploading", completed: index + 1, total: newItems.length, fileName: item.document.name });
    }
    checkCancellation(options.signal);
    metadataSize(careers, documents);
    report({ phase: "saving", completed: 0, total: 1 });
    await activateRestoredData({ careers, documents }, current.revision, current.activeVersion, {
      signal: options.signal,
      onCommitStarted: () => { commitStarted = true; },
    });
    report({ phase: "done", completed: 1, total: 1 });
    return result;
  } catch (error) {
    // Keep originals after an uncertain commit. A first-callback CAS rejection
    // explicitly proves no root write was attempted and allows safe cleanup.
    if (!commitStarted || error instanceof ArchiveRevisionConflictError)
      await Promise.allSettled(uploaded.map(id => trashDriveFile(id)));
    throw error;
  }
}
