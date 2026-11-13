import JSZip from "jszip";
import type { Career, DocumentRecord } from "../types";
import { readBackupFile, type RestoredDocument } from "./backup";
import { sha256, trashDriveFile, uploadDriveFile, validateDriveUploadFile } from "./drive";
import { normalizeCareer, normalizeDocumentRecord, validRecordId } from "./normalize";
import { activateRestoredData, ArchiveRevisionConflictError, readFreeSnapshot } from "./store";
import { automaticEvidencePlan, sameEvidenceCareer } from "./evidence-approval";
import { applyEvidenceDetails, readEvidenceDetails, type EvidenceCareerDetails } from "./evidence-details";

const MAX_METADATA_SIZE = 5 * 1024 * 1024;
const MAX_ORIGINALS_SIZE = 200 * 1024 * 1024;
const MAX_CAREERS = 100_000;
const MAX_DOCUMENTS = 10_000;

export interface EvidenceLinkCorrection {
  documentId: string;
  previousCareer: Pick<Career, "id" | "title" | "startDate">;
}

/** Carrier fields are identity labels. Explicit proposals and source-backed
 * detail patches have separate approval policies. */
export interface PreparedEvidenceImport {
  format: "career-evidence-import";
  version: 1;
  careers: Career[];
  documents: RestoredDocument[];
  newCareerIds?: string[];
  careerDetails?: EvidenceCareerDetails[];
  linkCorrections?: EvidenceLinkCorrection[];
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
  /** Omitted or [] never creates a career, even when the package suggests one. */
  approvedNewCareerIds?: string[];
  /** Chat-approved automatic imports recheck identity against the fresh snapshot. */
  requireMatchingCareerDetails?: boolean;
  /** Only the exact, separately approved archive policy enables new records. */
  allowAutomaticNewCareers?: boolean;
  /** Only the separately approved archive may enrich existing institutions/dates. */
  allowAutomaticCareerDetails?: boolean;
  /** Only the separately fingerprint-approved archive may remove reviewed links. */
  allowAutomaticLinkCorrections?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: EvidenceImportProgress) => void;
}
export interface EvidenceImportResult {
  added: number;
  duplicates: number;
  linked: number;
  careersUpdated: number;
  unmatched: number;
  careersAdded?: number;
  detailsUpdated?: number;
  detailsSkipped?: number;
  linksCorrected?: number;
  linkCorrectionsSkipped?: number;
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
function newCareerIds(value: unknown, careers: Career[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CAREERS || value.some(id => !validRecordId(id))
    || new Set(value).size !== value.length)
    throw new Error("추가할 새 경력 목록이 올바르지 않습니다.");
  const counts = new Map<string, number>();
  for (const career of careers) counts.set(career?.id, (counts.get(career?.id) || 0) + 1);
  if (value.some(id => counts.get(id) !== 1))
    throw new Error("새 경력의 내용이 없거나 ID가 중복되어 있습니다.");
  return [...value];
}

function readLinkCorrections(value: unknown, documents: { id: string; recordIds: string[] }[]): EvidenceLinkCorrection[] {
  if (value === undefined) return [];
  const invalid = (): never => { throw new Error("증빙 연결 수정 정보가 올바르지 않습니다."); };
  if (!Array.isArray(value) || value.length > MAX_DOCUMENTS) return invalid();
  const seen = new Set<string>();
  return value.map(raw => {
    if (!plainObject(raw) || Object.keys(raw).some(key => !["documentId", "previousCareer"].includes(key))
      || !validRecordId(raw.documentId) || !plainObject(raw.previousCareer)) return invalid();
    const previous = raw.previousCareer;
    if (Object.keys(previous).some(key => !["id", "title", "startDate"].includes(key))
      || !validRecordId(previous.id) || typeof previous.title !== "string" || !previous.title.trim()
      || previous.title !== previous.title.trim() || previous.title.length > 300
      || typeof previous.startDate !== "string" || !previous.startDate || previous.startDate.length > 10) return invalid();
    const normalized = normalizeCareer(previous);
    if (normalized.startDate !== previous.startDate) return invalid();
    const document = documents.find(item => item.id === raw.documentId);
    if (!document || !document.recordIds.length || document.recordIds.includes(previous.id)) return invalid();
    const key = `${raw.documentId}:${previous.id}`;
    if (seen.has(key)) return invalid();
    seen.add(key);
    return { documentId: raw.documentId, previousCareer: { id: previous.id, title: previous.title, startDate: previous.startDate } };
  });
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
  const suggestedIds = newCareerIds(marker.newCareerIds, restored.careers);
  checkCancellation(options.signal);
  return {
    format: "career-evidence-import", version: 1, careers: restored.careers, documents: restored.documents,
    ...(marker.newCareerIds === undefined ? {} : { newCareerIds: suggestedIds }),
    ...(marker.careerDetails === undefined ? {} : { careerDetails: readEvidenceDetails(marker.careerDetails, restored.careers, restored.documents) }),
    ...(marker.linkCorrections === undefined ? {} : { linkCorrections: readLinkCorrections(marker.linkCorrections, restored.documents) }),
  };
}

/**
 * Merge against a fresh server snapshot. Existing originals survive. Only
 * separately approved, source-backed patches can correct current career fields.
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
  const suggestedIds = new Set(newCareerIds(prepared.newCareerIds, prepared.careers));
  const selectedIds = options.approvedNewCareerIds === undefined ? [] : options.approvedNewCareerIds;
  if (!Array.isArray(selectedIds) || selectedIds.length > MAX_CAREERS
    || selectedIds.some(id => !validRecordId(id) || !suggestedIds.has(id))
    || new Set(selectedIds).size !== selectedIds.length)
    throw new Error("묶음에 제안된 새 경력 중 추가할 항목을 확인해 주세요.");
  const carrierById = new Map(prepared.careers.map(career => [career.id, career]));
  const allowAutomaticNewCareers = options.allowAutomaticNewCareers === true;
  const requestedDetails = readEvidenceDetails(prepared.careerDetails, prepared.careers, prepared.documents);
  const requestedCorrections = readLinkCorrections(prepared.linkCorrections, prepared.documents);
  if (requestedCorrections.length && !(options.requireMatchingCareerDetails && options.allowAutomaticLinkCorrections === true))
    throw new Error("이 증빙 묶음은 연결 수정 승인이 필요합니다. 승인된 최신 연결 링크를 사용해 주세요.");
  // Snapshot before awaits; an ordinary import can never opt itself into updates.
  const approvedDetails = options.requireMatchingCareerDetails && options.allowAutomaticCareerDetails === true ? requestedDetails : [];
  const automaticInput: PreparedEvidenceImport | null = options.requireMatchingCareerDetails ? {
    ...prepared, careers: prepared.careers.map(item => normalizeCareer(item)), newCareerIds: [...suggestedIds],
    careerDetails: approvedDetails,
    documents: prepared.documents.map(item => ({ ...item, recordIds: [...item.recordIds] })),
  } : null;
  if (automaticInput && selectedIds.length && !allowAutomaticNewCareers)
    throw new Error("새 이력은 연결 내용을 확인한 뒤 추가해 주세요.");
  // Snapshot normalized suggestions before awaits. Document links come only from
  // explicit owner choices below; a prepared package cannot claim verification.
  let approvedCareers = selectedIds.map(id => normalizeCareer({
    ...carrierById.get(id), id, documentIds: [], evidenceStatus: "later", verified: false,
  }));
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
  if (automaticInput) {
    const plan = automaticEvidencePlan(automaticInput, current.careers, allowAutomaticNewCareers, approvedDetails.length > 0);
    if (!plan || incoming.some(item => !item.links.length))
      throw new Error("연결 대상 이력이 변경되어 자동 저장을 멈췄습니다. 최신 연결 내용을 확인해 주세요.");
    // A record added in another tab between review and save is reused here.
    for (const item of incoming) item.links = plan.links[item.document.id];
    approvedCareers = plan.newCareerIds.map(id => normalizeCareer({
      ...automaticInput.careers.find(career => career.id === id), id,
      documentIds: [], evidenceStatus: "later", verified: false,
    }));
  }
  const liveCareerIds = new Set(current.careers.map(career => career.id));
  const newCareers = approvedCareers.filter(career => !liveCareerIds.has(career.id));
  const targetCareerIds = new Set([...liveCareerIds, ...newCareers.map(career => career.id)]);
  for (const item of incoming) {
    if (item.links.some(id => !targetCareerIds.has(id)))
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
  if (current.careers.length + newCareers.length > MAX_CAREERS || current.documents.length + newItems.length > MAX_DOCUMENTS)
    throw new Error("경력 또는 공문 개수가 보관함 한도를 초과합니다.");
  const linksByCareer = new Map<string, Set<string>>();
  for (const item of incoming) {
    const target = targetIds.get(item.document.id)!;
    for (const careerId of item.links) {
      const links = linksByCareer.get(careerId) || new Set<string>();
      links.add(target); linksByCareer.set(careerId, links);
    }
  }
  const removalsByCareer = new Map<string, Set<string>>();
  let linkCorrectionsSkipped = 0;
  for (const correction of requestedCorrections) {
    const item = incoming.find(value => value.document.id === correction.documentId)!;
    // The removed link must refer to a byte-verified original already in storage,
    // even when that original has a different live ID from the reviewed archive.
    const original = byHash.get(item.document.sha256);
    const previous = current.careers.find(career => career.id === correction.previousCareer.id);
    if (!original || !previous || !previous.documentIds.includes(original.id)) continue;
    if (!previous.startDate || previous.startDate.slice(0, 4) !== correction.previousCareer.startDate.slice(0, 4)
      || !sameEvidenceCareer(correction.previousCareer, previous) || !item.links.length || item.links.includes(previous.id)) {
      linkCorrectionsSkipped++;
      continue;
    }
    const removals = removalsByCareer.get(previous.id) || new Set<string>();
    removals.add(original.id); removalsByCareer.set(previous.id, removals);
  }
  let linked = 0, careersUpdated = 0, detailsUpdated = 0, detailsSkipped = 0, linksCorrected = 0;
  const careers = [...current.careers, ...newCareers].map(career => {
    const approved = linksByCareer.get(career.id);
    const removals = removalsByCareer.get(career.id);
    if (!approved && !removals) return career;
    const additions = [...(approved || [])].filter(id => !career.documentIds.includes(id));
    const retained = career.documentIds.filter(id => !removals?.has(id));
    linksCorrected += career.documentIds.length - retained.length;
    linked += additions.length;
    let updated = additions.length || retained.length !== career.documentIds.length
      ? normalizeCareer({ documentIds: [...retained, ...additions] }, career) : career;
    const details = approvedDetails.find(item => item.careerId === career.id);
    if (details && details.sourceDocumentIds.every(id => incoming.some(item => item.document.id === id && item.links.includes(career.id)))) {
      const enriched = applyEvidenceDetails(updated, details);
      if (enriched.career !== updated) detailsUpdated++;
      if (enriched.skipped) detailsSkipped++;
      updated = enriched.career;
    }
    if (updated !== career && liveCareerIds.has(career.id)) careersUpdated++;
    return updated;
  });
  const result: EvidenceImportResult = {
    added: newItems.length, duplicates: incoming.length - newItems.length, linked, careersUpdated,
    unmatched: incoming.filter(item => !item.links.length).length,
    ...(newCareers.length ? { careersAdded: newCareers.length } : {}),
    ...(detailsUpdated ? { detailsUpdated } : {}),
    ...(detailsSkipped ? { detailsSkipped } : {}),
    ...(linksCorrected ? { linksCorrected } : {}),
    ...(linkCorrectionsSkipped ? { linkCorrectionsSkipped } : {}),
  };
  const documents = [...current.documents, ...newItems.map(item => item.document)];
  metadataSize(careers, documents);
  if (!result.added && !result.linked && !result.careersAdded && !result.detailsUpdated && !result.linksCorrected) {
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
