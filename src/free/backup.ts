import JSZip from "jszip";
import type { Career, DocumentRecord } from "../types";
import { normalizeCareer, normalizeDocumentRecord, validRecordId as validId } from "./normalize";
import { normalizeWorkspace } from "../../shared/workspace.mjs";
import type { WorkspaceData } from "../workspace/types";

const MAX_BACKUP_SIZE = 200 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 5 * 1024 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_CAREERS = 100_000;
const MAX_DOCUMENTS = 10_000;
const MAX_ENTRIES = MAX_DOCUMENTS + 10;
const ALLOWED_EXTENSIONS = new Set(["pdf", "hwp", "hwpx", "docx", "txt", "xlsx", "png", "jpg", "jpeg", "webp"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const invalid = (message: string): Error => new Error(message);

export interface BackupDocument extends DocumentRecord {
  bytes: Uint8Array;
  sha256?: string;
}
export interface RestoredDocument extends BackupDocument {
  sha256: string;
}
export interface BackupManifest {
  format: "career-archive";
  version: 1;
  createdAt?: string;
  careers: Career[];
  documents: (DocumentRecord & { sha256: string; filePath: string })[];
  workspace?: Omit<WorkspaceData, "revision">;
}

interface ArchiveEntry {
  name: string;
  size: number;
  compressedSize: number;
  crc: number;
  directory: boolean;
}
// JSZip provides internalStream at runtime, but omits it from JSZipObject's types.
type StreamableEntry = JSZip.JSZipObject & {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function nextCrc(checksum: number, bytes: Uint8Array): number {
  let value = checksum ^ 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalPath(name: string): boolean {
  if (!name || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || /[\x00-\x1f\x7f]/.test(name)) return false;
  const parts = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  return parts.every(part => part && part !== "." && part !== "..");
}

/** Check sizes and paths before JSZip creates objects or starts decompression. */
function inspectArchive(bytes: Uint8Array): Map<string, ArchiveEntry> {
  if (bytes.length < 22 || bytes.length > MAX_BACKUP_SIZE) throw invalid("백업 ZIP 파일은 200MB 이하여야 합니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw invalid("ZIP 백업 파일 목록을 읽을 수 없습니다.");
  const count = u16(end + 10);
  const directorySize = u32(end + 12);
  const directoryStart = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count > MAX_ENTRIES || count === 0xffff
    || directorySize === 0xffffffff || directoryStart === 0xffffffff || directoryStart + directorySize !== end) {
    throw invalid("분할 ZIP, ZIP64 또는 지나치게 많은 항목이 있는 백업은 지원하지 않습니다.");
  }
  const entries = new Map<string, ArchiveEntry>();
  const ranges: [number, number][] = [];
  let offset = directoryStart;
  let total = 0;
  const checkExtras = (start: number, length: number) => {
    const limit = start + length;
    while (start < limit) {
      if (start + 4 > limit) throw invalid("ZIP 추가 정보가 손상되었습니다.");
      const tag = u16(start), size = u16(start + 2);
      if (tag === 0x0001) throw invalid("ZIP64 백업은 지원하지 않습니다.");
      start += 4 + size;
      if (start > limit) throw invalid("ZIP 추가 정보가 손상되었습니다.");
    }
  };
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) throw invalid("ZIP 백업 파일 목록이 손상되었습니다.");
    const flags = u16(offset + 8), method = u16(offset + 10);
    const crc = u32(offset + 16), compressedSize = u32(offset + 20), size = u32(offset + 24);
    const nameSize = u16(offset + 28), extraSize = u16(offset + 30), commentSize = u16(offset + 32);
    const local = u32(offset + 42);
    const next = offset + 46 + nameSize + extraSize + commentSize;
    if (next > end || u16(offset + 34) || local === 0xffffffff || compressedSize === 0xffffffff || size === 0xffffffff
      || (flags & ~(0x0800 | 0x0008 | 0x0006)) || ![0, 8].includes(method)) throw invalid("지원하지 않거나 손상된 ZIP 항목입니다.");
    let name: string;
    try { name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameSize)); }
    catch { throw invalid("ZIP 파일 이름은 UTF-8 형식이어야 합니다."); }
    if (!canonicalPath(name) || entries.has(name)) throw invalid("안전하지 않거나 중복된 파일 경로가 포함된 백업입니다.");
    if ((u32(offset + 38) >>> 16 & 0xf000) === 0xa000) throw invalid("심볼릭 링크가 포함된 백업은 지원하지 않습니다.");
    total += size;
    if (total > MAX_BACKUP_SIZE || size > (name === "manifest.json" ? MAX_MANIFEST_SIZE : MAX_FILE_SIZE)) {
      throw invalid("백업 항목의 압축 해제 용량이 제한을 초과합니다.");
    }
    checkExtras(offset + 46 + nameSize, extraSize);
    // Central and local names/sizes must describe the same, non-overlapping data.
    if (local + 30 > directoryStart || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) {
      throw invalid("ZIP 원본 항목 정보가 손상되었습니다.");
    }
    const localNameSize = u16(local + 26), localExtraSize = u16(local + 28);
    const dataStart = local + 30 + localNameSize + localExtraSize;
    let dataEnd = dataStart + compressedSize;
    if (dataStart > directoryStart || dataEnd > directoryStart || localNameSize !== nameSize
      || bytes.subarray(local + 30, local + 30 + localNameSize).some((byte, index) => byte !== bytes[offset + 46 + index])) {
      throw invalid("ZIP 파일 경로 또는 압축 크기가 일치하지 않습니다.");
    }
    checkExtras(local + 30 + localNameSize, localExtraSize);
    if (!(flags & 8)) {
      if (u32(local + 14) !== crc || u32(local + 18) !== compressedSize || u32(local + 22) !== size) throw invalid("ZIP 원본 크기 또는 CRC 정보가 일치하지 않습니다.");
    } else {
      if (dataEnd + 12 > directoryStart) throw invalid("ZIP 데이터 설명자가 손상되었습니다.");
      if (u32(dataEnd) === 0x08074b50) dataEnd += 4;
      if (dataEnd + 12 > directoryStart || u32(dataEnd) !== crc || u32(dataEnd + 4) !== compressedSize || u32(dataEnd + 8) !== size) {
        throw invalid("ZIP 데이터 설명자가 일치하지 않습니다.");
      }
      dataEnd += 12;
    }
    const directory = name.endsWith("/");
    if (directory && (name !== "originals/" || size || compressedSize || crc)) throw invalid("지원하지 않는 ZIP 폴더 항목입니다.");
    entries.set(name, { name, size, compressedSize, crc, directory });
    ranges.push([local, dataEnd]);
    offset = next;
  }
  if (offset !== end) throw invalid("ZIP 백업 파일 목록의 크기가 일치하지 않습니다.");
  let previousEnd = 0;
  for (const [start, finish] of ranges.sort((a, b) => a[0] - b[0])) {
    if (start !== previousEnd) throw invalid("ZIP 원본 항목이 겹치거나 누락되었습니다.");
    previousEnd = finish;
  }
  if (previousEnd !== directoryStart) throw invalid("ZIP 백업에 확인되지 않은 데이터가 있습니다.");
  return entries;
}

/** Stop collecting and pause inflation as soon as the declared bound is exceeded. */
function readEntry(file: JSZip.JSZipObject, entry: ArchiveEntry): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let chunks: Uint8Array[] = [], size = 0, crc = 0, ended = false;
    const stream = (file as StreamableEntry).internalStream("uint8array");
    const fail = (message: string) => {
      if (ended) return;
      ended = true; chunks = []; stream.pause(); reject(invalid(message));
    };
    stream.on("data", chunk => {
      if (ended) return;
      size += chunk.length;
      if (size > entry.size) return fail("백업 항목의 실제 압축 해제 용량이 선언된 크기를 초과합니다.");
      crc = nextCrc(crc, chunk); chunks.push(chunk);
    });
    stream.on("error", () => fail("백업 압축 데이터가 손상되었습니다."));
    stream.on("end", () => {
      if (ended) return;
      if (size !== entry.size || crc !== entry.crc) return fail("백업 항목의 크기, CRC 무결성 검증에 실패했습니다.");
      ended = true;
      const output = new Uint8Array(size);
      let position = 0;
      for (const chunk of chunks) { output.set(chunk, position); position += chunk.length; }
      chunks = []; resolve(output);
    });
    stream.resume();
  });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("백업 목록 항목이 올바르지 않습니다.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (value == null) return "";
  if (typeof value !== "string") throw invalid("백업 목록의 문자열 항목이 올바르지 않습니다.");
  return value.trim().slice(0, max);
}
function normalizedCareer(value: unknown): Career {
  const input = record(value);
  if (!validId(input.id) || !Array.isArray(input.documentIds) || !input.documentIds.every(validId)) throw invalid("백업 경력 목록 또는 증빙 연결이 올바르지 않습니다.");
  // The same pure validator protects direct Firestore writes and ZIP restore.
  return normalizeCareer(input);
}

export async function readBackupFile(file: File, options: { allowEvidenceImport?: boolean } = {}): Promise<{ careers: Career[]; documents: RestoredDocument[]; manifest: BackupManifest; workspace?: WorkspaceData }> {
  if (!Number.isSafeInteger(file.size) || file.size > MAX_BACKUP_SIZE) throw invalid("백업 ZIP 파일은 200MB 이하여야 합니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = inspectArchive(bytes);
  let zip: JSZip;
  // Checking CRC through loadAsync would inflate every entry without bounds.
  // readEntry instead verifies CRC incrementally while enforcing each exact size.
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false }); }
  catch { throw invalid("올바른 ZIP 백업 파일이 아닙니다."); }
  if (Object.keys(zip.files).length !== entries.size) throw invalid("ZIP 파일 목록이 일치하지 않습니다.");
  for (const [name, entry] of entries) {
    const loaded = zip.files[name];
    if (!loaded || loaded.name !== name || (loaded.unsafeOriginalName ?? name) !== name || loaded.dir !== entry.directory) throw invalid("ZIP 파일 경로가 일치하지 않습니다.");
  }
  const manifestEntry = entries.get("manifest.json"), manifestFile = zip.file("manifest.json");
  if (!manifestEntry || !manifestFile) throw invalid("경력 백업의 manifest.json을 찾을 수 없습니다.");
  let raw: Record<string, unknown>;
  const manifestBytes = await readEntry(manifestFile, manifestEntry);
  try { raw = record(JSON.parse(decoder.decode(manifestBytes))); }
  catch { throw invalid("백업 목록을 읽을 수 없습니다."); }
  if (raw.evidenceImport != null && !options.allowEvidenceImport)
    throw invalid("증빙 추가 묶음은 ‘정리한 증빙 가져오기’에서 추가해 주세요. 전체 기록 복원에는 사용할 수 없습니다.");
  if (raw.format !== "career-archive" || raw.version !== 1 || !Array.isArray(raw.careers) || !Array.isArray(raw.documents)
    || raw.careers.length > MAX_CAREERS || raw.documents.length > MAX_DOCUMENTS) throw invalid("지원하지 않는 경력 백업 형식입니다.");
  const careers = raw.careers.map(normalizedCareer);
  const careerIds = new Set(careers.map(career => career.id));
  if (careerIds.size !== careers.length) throw invalid("중복된 경력 ID가 포함된 백업입니다.");
  const documentIds = new Set<string>(), paths = new Set<string>(), hashes = new Set<string>();
  const metadata = raw.documents.map(value => {
    const input = record(value);
    if (!validId(input.id) || documentIds.has(input.id) || typeof input.filePath !== "string" || !/^originals\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(input.filePath)
      || paths.has(input.filePath) || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256) || hashes.has(input.sha256)) throw invalid("백업 파일 목록의 경로, ID, 무결성 정보가 올바르지 않습니다.");
    const extension = input.filePath.split(".").at(-1)!;
    if (!ALLOWED_EXTENSIONS.has(extension) || !zip.file(input.filePath)) throw invalid("백업 원본 파일이 없거나 지원하지 않는 형식입니다.");
    const entry = entries.get(input.filePath)!;
    if (input.size != null && input.size !== entry.size) throw invalid("백업 원본 파일의 크기가 목록과 일치하지 않습니다.");
    documentIds.add(input.id); paths.add(input.filePath); hashes.add(input.sha256);
    return { input, entry };
  });
  const links = new Map<string, string[]>();
  for (const career of careers) {
    for (const id of career.documentIds) {
      if (!documentIds.has(id)) throw invalid("백업 경력이 존재하지 않는 증빙 파일을 참조합니다.");
      const linked = links.get(id) ?? []; linked.push(career.id); links.set(id, linked);
    }
  }
  for (const name of entries.keys()) {
    if (name !== "manifest.json" && name !== "originals/" && name !== "경력목록.csv" && !paths.has(name)) throw invalid("백업 목록에 없는 원본 파일이 포함되어 있습니다.");
  }
  const documents: RestoredDocument[] = [];
  const manifestDocuments: BackupManifest["documents"] = [];
  for (const { input, entry } of metadata) {
    const id = input.id as string, filePath = input.filePath as string;
    const content = await readEntry(zip.file(filePath)!, entry);
    if (await sha256(content) !== input.sha256) throw invalid("백업 원본 파일의 SHA-256 무결성 검증에 실패했습니다.");
    const doc: RestoredDocument = {
      id, name: text(input.name, 300), size: content.length, mime: text(input.mime, 100),
      createdAt: text(input.createdAt, 50), text: text(input.text, 100_000), analysisStatus: text(input.analysisStatus, 50),
      recordIds: links.get(id) ?? [], sha256: input.sha256 as string, bytes: content,
    };
    documents.push(doc);
    const { bytes: _bytes, ...visible } = doc;
    manifestDocuments.push({ ...visible, filePath });
  }
  const csvEntry = entries.get("경력목록.csv");
  if (csvEntry) await readEntry(zip.file("경력목록.csv")!, csvEntry);
  const workspace = raw.workspace === undefined ? undefined : normalizeWorkspace(raw.workspace, { careerIds: careers.map(career => career.id), revision: 0 });
  return { careers, documents, ...(workspace ? { workspace } : {}), manifest: { format: "career-archive", version: 1, createdAt: text(raw.createdAt, 50), careers, documents: manifestDocuments, ...(workspace ? { workspace } : {}) } };
}

/**
 * Read metadata-only Drive snapshots. The caller must verify every referenced
 * original against its size and SHA-256 before activating a restored version.
 * File contents and credentials are never read or returned by this parser.
 */
export async function readDriveSnapshotFile(file: File): Promise<{ careers: Career[]; documents: DocumentRecord[]; workspace?: WorkspaceData }> {
  if (!/\.json$/i.test(file.name)) throw invalid("드라이브 경력 백업은 JSON 파일이어야 합니다.");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_MANIFEST_SIZE) throw invalid("드라이브 경력 백업 JSON은 5MB 이하여야 합니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_MANIFEST_SIZE) throw invalid("드라이브 경력 백업 JSON은 5MB 이하여야 합니다.");
  let raw: Record<string, unknown>;
  try { raw = record(JSON.parse(decoder.decode(bytes))); }
  catch { throw invalid("드라이브 경력 백업 JSON을 읽을 수 없습니다."); }
  if (raw.format !== "career-drive-snapshot" || raw.version !== 1 || !Array.isArray(raw.careers) || !Array.isArray(raw.documents)
    || raw.careers.length > MAX_CAREERS || raw.documents.length > MAX_DOCUMENTS
    || typeof raw.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw.createdAt)
    || !Number.isFinite(Date.parse(raw.createdAt))) throw invalid("지원하지 않는 드라이브 경력 백업 형식입니다.");
  const careers = raw.careers.map(normalizedCareer);
  if (new Set(careers.map(career => career.id)).size !== careers.length) throw invalid("중복된 경력 ID가 포함된 백업입니다.");
  const documentIds = new Set<string>(), hashes = new Set<string>(), driveIds = new Set<string>();
  let originalBytes = 0;
  const documents = raw.documents.map(value => {
    const input = record(value);
    if (!validId(input.id) || documentIds.has(input.id) || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)
      || hashes.has(input.sha256) || typeof input.driveFileId !== "string" || !/^[A-Za-z0-9_-]{8,200}$/.test(input.driveFileId)
      || driveIds.has(input.driveFileId)) throw invalid("드라이브 백업의 파일 ID, 중복, 무결성 정보가 올바르지 않습니다.");
    const document = normalizeDocumentRecord(input);
    originalBytes += document.size;
    if (!Number.isSafeInteger(originalBytes)) throw invalid("드라이브 백업의 원본 파일 합계가 올바르지 않습니다.");
    documentIds.add(document.id); hashes.add(input.sha256); driveIds.add(input.driveFileId);
    return document;
  });
  // Referring to existing Drive originals does not require loading them all into
  // memory, so the 200MB ZIP limit does not apply to a metadata-only snapshot.
  const links = new Map<string, string[]>();
  for (const career of careers) {
    for (const id of career.documentIds) {
      if (!documentIds.has(id)) throw invalid("드라이브 백업 경력이 존재하지 않는 증빙 파일을 참조합니다.");
      const linked = links.get(id) ?? []; linked.push(career.id); links.set(id, linked);
    }
    if (encoder.encode(JSON.stringify(career)).length > 128 * 1024) throw invalid("경력 메타데이터의 크기가 저장 한도를 초과했습니다.");
  }
  for (const document of documents) {
    document.recordIds = links.get(document.id) ?? [];
    if (encoder.encode(JSON.stringify(document)).length > 128 * 1024) throw invalid("공문 메타데이터의 크기가 저장 한도를 초과했습니다.");
  }
  const workspace = raw.workspace === undefined ? undefined : normalizeWorkspace(raw.workspace, { careerIds: careers.map(career => career.id), revision: 0 });
  return { careers, documents, ...(workspace ? { workspace } : {}) };
}

export async function createBackupBlob(data: { careers: Career[]; documents: BackupDocument[]; workspace?: WorkspaceData }): Promise<Blob> {
  if (data.careers.length > MAX_CAREERS || data.documents.length > MAX_DOCUMENTS) throw invalid("백업 항목 수가 복원 가능 범위를 초과했습니다.");
  const careers = data.careers.map(normalizedCareer);
  if (new Set(careers.map(career => career.id)).size !== careers.length) throw invalid("중복된 경력 ID가 있습니다.");
  const documentIds = new Set<string>(), hashes = new Set<string>();
  const documents: BackupManifest["documents"] = [];
  const zip = new JSZip();
  let total = 0;
  for (const document of data.documents) {
    if (!validId(document.id) || documentIds.has(document.id) || !(document.bytes instanceof Uint8Array)) throw invalid("백업 파일 항목이 올바르지 않습니다.");
    const extension = document.name.split(".").at(-1)?.toLowerCase();
    if (!extension || !ALLOWED_EXTENSIONS.has(extension)) throw invalid("지원하지 않는 원본 파일 형식입니다.");
    total += document.bytes.length;
    if (document.bytes.length > MAX_FILE_SIZE || total > MAX_BACKUP_SIZE) throw invalid("원본 파일은 각각 25MB, 백업 합계는 200MB 이하여야 합니다.");
    const hash = await sha256(document.bytes);
    if (hashes.has(hash) || document.sha256 && document.sha256 !== hash) throw invalid("보관된 원본 파일의 중복, 무결성 검증에 실패했습니다.");
    hashes.add(hash); documentIds.add(document.id);
    const filePath = `originals/${document.id}.${extension}`;
    const metadata: BackupManifest["documents"][number] = {
      id: document.id, name: text(document.name, 300), size: document.bytes.length, mime: text(document.mime, 100),
      createdAt: text(document.createdAt, 50), text: text(document.text, 100_000), analysisStatus: text(document.analysisStatus, 50),
      recordIds: [], sha256: hash, filePath,
    };
    documents.push(metadata); zip.file(filePath, document.bytes);
  }
  const links = new Map<string, string[]>();
  for (const career of careers) {
    for (const id of career.documentIds) {
      if (!documentIds.has(id)) throw invalid("경력에 연결된 증빙 원본이 백업에 없습니다.");
      const linked = links.get(id) ?? []; linked.push(career.id); links.set(id, linked);
    }
  }
  for (const document of documents) document.recordIds = links.get(document.id) ?? [];
  const normalizedWorkspace = data.workspace === undefined ? undefined : normalizeWorkspace(data.workspace, { careerIds: careers.map(career => career.id), revision: 0 });
  const workspace = normalizedWorkspace === undefined ? undefined : { schemaVersion: 1 as const, items: normalizedWorkspace.items, links: normalizedWorkspace.links };
  const manifest: BackupManifest = { format: "career-archive", version: 1, createdAt: new Date().toISOString(), careers, documents, ...(workspace ? { workspace } : {}) };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_SIZE) throw invalid("경력, 공문 목록은 5MB 이하여야 합니다.");
  if (total + manifestBytes.length > MAX_BACKUP_SIZE) throw invalid("원본, 경력 목록의 백업 합계가 200MB를 초과했습니다.");
  zip.file("manifest.json", manifestBytes);
  return new Promise((resolve, reject) => {
    let chunks: BlobPart[] = [], size = 0, ended = false;
    const stream = zip.generateInternalStream({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 5 } });
    stream.on("data", chunk => {
      if (ended) return;
      size += chunk.length;
      if (size > MAX_BACKUP_SIZE) {
        ended = true; chunks = []; stream.pause(); reject(invalid("압축한 백업 ZIP이 200MB를 초과했습니다.")); return;
      }
      chunks.push(new Uint8Array(chunk).buffer);
    });
    stream.on("error", () => { if (!ended) { ended = true; chunks = []; reject(invalid("백업 ZIP을 생성하지 못했습니다.")); } });
    stream.on("end", () => { if (!ended) { ended = true; resolve(new Blob(chunks, { type: "application/zip" })); chunks = []; } });
    stream.resume();
  });
}
