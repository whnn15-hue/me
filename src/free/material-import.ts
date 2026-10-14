import JSZip from "jszip";
import type { DocumentRecord } from "../types";
import type { MaterialItem, WorkspaceData } from "../workspace/types";
import { MAX_WORKSPACE_ITEMS, normalizeWorkspace, normalizeWorkspaceItem, validWorkspaceId } from "../../shared/workspace.mjs";
import { readBackupFile, type RestoredDocument } from "./backup";
import { sha256, trashDriveFile, uploadDriveFile, validateDriveUploadFile } from "./drive";
import { normalizeDocumentRecord, validRecordId } from "./normalize";
import { activateRestoredData, ArchiveRevisionConflictError, readFreeSnapshot, validateFreeSnapshotBudget } from "./store";

const MAX_METADATA_SIZE = 5 * 1024 * 1024;
const MAX_ORIGINALS_SIZE = 200 * 1024 * 1024;
const MAX_ORIGINAL_SIZE = 25 * 1024 * 1024;

export interface MaterialImportEntry { item: MaterialItem; documentId: string; }
export interface PreparedMaterialImport {
  format: "classroom-material-import";
  version: 1;
  materials: MaterialImportEntry[];
  /** Transfer-only originals. They never become career evidence records. */
  documents: RestoredDocument[];
}
export interface MaterialImportProgress {
  phase: "validating" | "uploading" | "saving" | "done";
  completed: number;
  total: number;
  fileName?: string;
}
export interface MaterialImportOptions {
  approvedMaterialIds: string[];
  signal?: AbortSignal;
  onProgress?: (progress: MaterialImportProgress) => void;
}
export interface MaterialImportResult { added: number; duplicates: number; skipped: number; }

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("가져오기를 취소했습니다.", "AbortError");
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}
function materialEntries(value: unknown, documents: RestoredDocument[]): MaterialImportEntry[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_WORKSPACE_ITEMS
    || value.length !== documents.length) throw new Error("수업 자료와 원본 파일 목록이 일치하지 않습니다.");
  const documentIds = new Set(documents.map(document => document.id));
  if (documentIds.size !== documents.length) throw new Error("수업 자료의 원본 ID가 중복되어 있습니다.");
  const ids = new Set<string>(), usedDocuments = new Set<string>();
  return value.map(entry => {
    if (!plainObject(entry) || !validRecordId(entry.documentId) || !documentIds.has(entry.documentId)
      || usedDocuments.has(entry.documentId) || !plainObject(entry.item)
      || !validWorkspaceId(entry.item.id) || ids.has(entry.item.id)
      || entry.item.kind !== "material" || entry.item.purpose !== "classroom"
      || entry.item.fileUrl !== "") throw new Error("수업 자료의 종류, ID 또는 원본 연결을 확인해 주세요.");
    const item = normalizeWorkspaceItem(entry.item);
    if (item.kind !== "material" || item.purpose !== "classroom") throw new Error("수업 자료만 가져올 수 있습니다.");
    ids.add(item.id); usedDocuments.add(entry.documentId);
    return { item, documentId: entry.documentId };
  });
}

/** Reuse bounded ZIP inflation, CRC and SHA checks without enabling full restore. */
export async function readMaterialImportFile(file: File, options: { signal?: AbortSignal } = {}): Promise<PreparedMaterialImport> {
  checkCancellation(options.signal);
  const restored = await readBackupFile(file, { allowMaterialImport: true });
  checkCancellation(options.signal);
  // The immutable File has already passed the ZIP entry and inflation bounds.
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("수업 자료 가져오기 목록을 찾을 수 없습니다.");
  const bytes = await manifestFile.async("uint8array");
  if (bytes.byteLength > MAX_METADATA_SIZE) throw new Error("수업 자료 목록은 5 MB 이하여야 합니다.");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("수업 자료 가져오기 목록을 읽을 수 없습니다."); }
  const marker = plainObject(raw) ? raw.materialImport : undefined;
  if (!plainObject(raw) || !plainObject(marker) || marker.format !== "classroom-material-import" || marker.version !== 1
    || raw.evidenceImport !== undefined || raw.workspace !== undefined || restored.careers.length
    || !Array.isArray(raw.documents) || raw.documents.some(document => !plainObject(document)
      || !Array.isArray(document.recordIds) || document.recordIds.length))
    throw new Error("수업 자료 전용 가져오기 파일을 선택해 주세요.");
  const materials = materialEntries(marker.materials, restored.documents);
  checkCancellation(options.signal);
  return { format: "classroom-material-import", version: 1, materials, documents: restored.documents };
}

/** Add approved classroom links while retaining every existing archive record. */
export async function applyMaterialImport(prepared: PreparedMaterialImport, options: MaterialImportOptions): Promise<MaterialImportResult> {
  checkCancellation(options.signal);
  if (!prepared || prepared.format !== "classroom-material-import" || prepared.version !== 1
    || !Array.isArray(prepared.documents) || !prepared.documents.length || prepared.documents.length > MAX_WORKSPACE_ITEMS)
    throw new Error("수업 자료 가져오기 파일이 올바르지 않습니다.");
  const materials = materialEntries(prepared.materials, prepared.documents);
  const offeredIds = new Set(materials.map(entry => entry.item.id));
  if (!Array.isArray(options.approvedMaterialIds) || options.approvedMaterialIds.length > MAX_WORKSPACE_ITEMS
    || options.approvedMaterialIds.some(id => !offeredIds.has(id))
    || new Set(options.approvedMaterialIds).size !== options.approvedMaterialIds.length)
    throw new Error("가져올 수업 자료를 목록에서 선택해 주세요.");
  const approved = new Set(options.approvedMaterialIds);
  const report = (progress: MaterialImportProgress) => options.onProgress?.(progress);
  // Snapshot all preview metadata and bytes before the first await.
  let totalBytes = 0;
  const originals = prepared.documents.map(source => {
    if (!source || !(source.bytes instanceof Uint8Array) || !Array.isArray(source.recordIds) || source.recordIds.length)
      throw new Error("수업 자료의 원본 파일을 읽을 수 없습니다.");
    totalBytes += source.bytes.byteLength;
    if (source.bytes.byteLength > MAX_ORIGINAL_SIZE || totalBytes > MAX_ORIGINALS_SIZE)
      throw new Error("원본은 각각 25 MB, 한 번에 200 MB 이하여야 합니다.");
    const { bytes, driveFileId: _untrustedDriveId, ...metadata } = source;
    return { document: normalizeDocumentRecord(metadata), bytes: new Uint8Array(bytes) };
  });
  const incoming = new Map<string, { document: DocumentRecord & { sha256: string }; file: File }>();
  const hashes = new Set<string>();
  report({ phase: "validating", completed: 0, total: originals.length });
  for (const [index, { document, bytes }] of originals.entries()) {
    checkCancellation(options.signal);
    if (!document.sha256 || hashes.has(document.sha256) || incoming.has(document.id)
      || document.size !== bytes.byteLength || await sha256(bytes) !== document.sha256)
      throw new Error("수업 자료 원본의 중복, 크기 또는 SHA-256 무결성 검증에 실패했습니다.");
    const file = new File([new Uint8Array(bytes).buffer], document.name, { type: document.mime });
    await validateDriveUploadFile(file);
    hashes.add(document.sha256);
    incoming.set(document.id, { document: document as DocumentRecord & { sha256: string }, file });
    report({ phase: "validating", completed: index + 1, total: originals.length, fileName: document.name });
  }
  checkCancellation(options.signal);
  const selected = materials.filter(entry => approved.has(entry.item.id));
  const result = { added: 0, duplicates: 0, skipped: materials.length - selected.length };
  if (!selected.length) { report({ phase: "done", completed: 1, total: 1 }); return result; }
  const current = await readFreeSnapshot();
  checkCancellation(options.signal);
  const liveItems = new Map(current.workspace.items.map(item => [item.id, item]));
  for (const entry of selected) {
    const existing = liveItems.get(entry.item.id);
    if (existing && existing.kind !== "material") throw new Error("다른 종류의 기록에서 사용 중인 자료 ID입니다.");
  }
  const additions = selected.filter(entry => !liveItems.has(entry.item.id));
  result.added = additions.length; result.duplicates = selected.length - additions.length;
  if (!additions.length) { report({ phase: "done", completed: 1, total: 1 }); return result; }
  const mergedWorkspace = (items: MaterialItem[]): WorkspaceData => normalizeWorkspace({
    ...current.workspace, items: [...current.workspace.items, ...items],
  }, { careerIds: current.careers.map(career => career.id), revision: current.revision });
  // Budget a maximum length Drive ID before any upload, then validate final URLs.
  const preview = mergedWorkspace(additions.map(({ item }) => ({
    ...item, fileUrl: `https://drive.google.com/file/d/${"x".repeat(200)}/view`,
  })));
  validateFreeSnapshotBudget(current.careers, current.documents, preview);
  const uploaded: string[] = [], savedItems: MaterialItem[] = [];
  let commitStarted = false;
  try {
    report({ phase: "uploading", completed: 0, total: additions.length });
    for (const [index, entry] of additions.entries()) {
      checkCancellation(options.signal);
      const original = incoming.get(entry.documentId)!;
      report({ phase: "uploading", completed: index, total: additions.length, fileName: original.file.name });
      const stored = await uploadDriveFile(original.file, "document", original.document.sha256);
      if (!/^[A-Za-z0-9_-]{8,200}$/.test(stored.id)) throw new Error("저장한 수업 자료의 드라이브 주소를 확인할 수 없습니다.");
      uploaded.push(stored.id);
      checkCancellation(options.signal);
      savedItems.push({ ...entry.item, fileUrl: `https://drive.google.com/file/d/${stored.id}/view` });
      report({ phase: "uploading", completed: index + 1, total: additions.length, fileName: original.file.name });
    }
    checkCancellation(options.signal);
    const workspace = mergedWorkspace(savedItems);
    validateFreeSnapshotBudget(current.careers, current.documents, workspace);
    report({ phase: "saving", completed: 0, total: 1 });
    await activateRestoredData({ careers: current.careers, documents: current.documents, workspace }, current.revision, current.activeVersion, {
      signal: options.signal, onCommitStarted: () => { commitStarted = true; },
    });
    report({ phase: "done", completed: 1, total: 1 });
    return result;
  } catch (error) {
    // A network error after the commit begins may have saved the links already.
    if (!commitStarted || error instanceof ArchiveRevisionConflictError)
      await Promise.allSettled(uploaded.map(id => trashDriveFile(id)));
    throw error;
  }
}
