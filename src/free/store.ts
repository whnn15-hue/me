import {
  collection, doc, getDocFromServer, getDocsFromServer, getFirestore,
  runTransaction, writeBatch, type DocumentReference, type Firestore, type Transaction,
} from "firebase/firestore";
import { getFirebaseApp, readyCloudUser } from "../cloud";
import { type Career, type DocumentRecord } from "../types";
import { normalizeCareer, normalizeDocumentRecord, validRecordId } from "./normalize";

export interface FreeSnapshot {
  careers: Career[];
  documents: DocumentRecord[];
  revision: number;
  activeVersion: string;
}
interface Context { db: Firestore; root: DocumentReference; }
interface RootState { activeVersion: string; revision: number; }
class ChangedSnapshot extends Error {}
/** No transaction callback has reached a possible root-pointer commit. */
export class ArchiveRevisionConflictError extends Error {
  constructor() {
    super("다른 화면에서 기록이 변경되었습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.");
    this.name = "ArchiveRevisionConflictError";
  }
}
const MAX_RETRIES = 5;
const conflict = () => new Error("다른 화면에서 기록이 변경되었습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.");

async function context(): Promise<Context> {
  const user = await readyCloudUser();
  if (!user || !user.emailVerified || !user.email || !user.providerData.some(provider => provider.providerId === "google.com")) throw new Error("이메일이 확인된 본인 구글 계정으로 로그인해 주세요.");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(user.uid)) throw new Error("로그인 계정 ID를 확인할 수 없습니다.");
  const app = getFirebaseApp();
  if (!app) throw new Error("Firebase 연결 설정이 필요합니다.");
  const db = getFirestore(app);
  return { db, root: doc(db, "careerArchives", user.uid) };
}
function rootState(data: unknown): RootState {
  if (data === undefined) return { activeVersion: "", revision: 0 };
  if (!data || typeof data !== "object") throw new Error("경력 보관함의 설정을 읽을 수 없습니다.");
  const value = data as Record<string, unknown>;
  if (!validRecordId(value.activeVersion) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new Error("경력 보관함의 버전 정보가 올바르지 않습니다.");
  return { activeVersion: value.activeVersion, revision: value.revision as number };
}
function sameRoot(first: RootState, second: RootState) { return first.activeVersion === second.activeVersion && first.revision === second.revision; }
function row(ctx: Context, version: string, kind: "careers" | "documents", id: string) { return doc(ctx.root, "versions", version, kind, id); }
function linkedDocument(document: DocumentRecord, careers: Career[]): DocumentRecord {
  return { ...document, recordIds: careers.filter(career => career.documentIds.includes(document.id)).map(career => career.id) };
}
function documentMetadata(document: DocumentRecord) {
  const { recordIds: _computedLinks, ...metadata } = document;
  return metadata;
}
function checkLinks(career: Career, documents: DocumentRecord[]) {
  const ids = new Set(documents.map(document => document.id));
  if (career.documentIds.some(id => !ids.has(id))) throw new Error("연결할 공문 파일을 찾을 수 없습니다.");
}
function nextRevision(revision: number) {
  if (revision >= Number.MAX_SAFE_INTEGER) throw new Error("보관함 버전 한도에 도달했습니다.");
  return revision + 1;
}
async function snapshot(ctx: Context): Promise<FreeSnapshot> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const before = rootState((await getDocFromServer(ctx.root)).data());
    let careers: Career[] = [], documents: DocumentRecord[] = [];
    if (before.activeVersion) {
      const [careerQuery, documentQuery] = await Promise.all([
        getDocsFromServer(collection(ctx.root, "versions", before.activeVersion, "careers")),
        getDocsFromServer(collection(ctx.root, "versions", before.activeVersion, "documents")),
      ]);
      careers = careerQuery.docs.map(item => {
        const data = item.data();
        if (data.id !== item.id) throw new Error("경력 ID와 저장 위치가 일치하지 않습니다.");
        return normalizeCareer(data);
      });
      documents = documentQuery.docs.map(item => {
        const data = item.data();
        if (data.id !== item.id) throw new Error("공문 ID와 저장 위치가 일치하지 않습니다.");
        return normalizeDocumentRecord(data);
      });
    }
    const after = rootState((await getDocFromServer(ctx.root)).data());
    if (sameRoot(before, after)) {
      for (const career of careers) checkLinks(career, documents);
      return { ...after, careers, documents: documents.map(document => linkedDocument(document, careers)) };
    }
  }
  throw conflict();
}

/** Server-only reads avoid reporting an offline cached archive as current. */
export async function readFreeSnapshot(): Promise<FreeSnapshot> { return snapshot(await context()); }
export async function readFreeData(): Promise<Pick<FreeSnapshot, "careers" | "documents">> {
  const { careers, documents } = await readFreeSnapshot();
  return { careers, documents };
}
type MutationResult<T> = { value: T; changed: boolean };
async function mutate<T>(work: (view: FreeSnapshot, tx: Transaction, ctx: Context, version: string) => MutationResult<T>): Promise<T> {
  const ctx = await context();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const view = await snapshot(ctx);
    const version = view.activeVersion || crypto.randomUUID();
    try {
      return await runTransaction(ctx.db, async tx => {
        const actual = rootState((await tx.get(ctx.root)).data());
        if (!sameRoot(view, actual)) throw new ChangedSnapshot();
        const result = work(view, tx, ctx, version);
        if (result.changed) tx.set(ctx.root, { activeVersion: version, revision: nextRevision(view.revision) }, { merge: true });
        return result.value;
      });
    } catch (error) {
      if (!(error instanceof ChangedSnapshot)) throw error;
    }
  }
  throw conflict();
}
export async function createFreeCareer(input: unknown): Promise<Career> {
  const career = { ...normalizeCareer(input), id: crypto.randomUUID() };
  return mutate((view, tx, ctx, version) => {
    checkLinks(career, view.documents);
    if (view.careers.some(existing => existing.id === career.id)) throw new Error("이미 사용 중인 경력 ID입니다.");
    tx.set(row(ctx, version, "careers", career.id), career);
    return { value: career, changed: true };
  });
}
export async function updateFreeCareer(id: string, input: unknown): Promise<Career> {
  if (!validRecordId(id)) throw new Error("경력 ID가 올바르지 않습니다.");
  return mutate((view, tx, ctx, version) => {
    const previous = view.careers.find(career => career.id === id);
    if (!previous) throw new Error("경력을 찾을 수 없습니다.");
    const career = normalizeCareer(input, previous);
    checkLinks(career, view.documents); tx.set(row(ctx, version, "careers", id), career);
    return { value: career, changed: true };
  });
}
export async function deleteFreeCareer(id: string): Promise<void> {
  if (!validRecordId(id)) throw new Error("경력 ID가 올바르지 않습니다.");
  return mutate((view, tx, ctx, version) => {
    if (!view.careers.some(career => career.id === id)) throw new Error("경력을 찾을 수 없습니다.");
    tx.delete(row(ctx, version, "careers", id)); return { value: undefined, changed: true };
  });
}
export async function addFreeDocument(input: DocumentRecord): Promise<{ document: DocumentRecord; duplicate: boolean }> {
  const document = normalizeDocumentRecord(input);
  if (!document.driveFileId || !document.sha256) throw new Error("공문을 구글 드라이브에 보관한 뒤 등록해 주세요.");
  return mutate<{ document: DocumentRecord; duplicate: boolean }>((view, tx, ctx, version) => {
    const duplicate = view.documents.find(existing => existing.sha256 === document.sha256);
    if (duplicate) return { value: { document: linkedDocument(duplicate, view.careers), duplicate: true }, changed: false };
    if (view.documents.some(existing => existing.id === document.id)) throw new Error("이미 사용 중인 공문 ID입니다.");
    tx.set(row(ctx, version, "documents", document.id), documentMetadata(document));
    return { value: { document: linkedDocument(document, view.careers), duplicate: false }, changed: true };
  });
}
export async function deleteFreeDocument(id: string): Promise<DocumentRecord> {
  if (!validRecordId(id)) throw new Error("공문 ID가 올바르지 않습니다.");
  return mutate((view, tx, ctx, version) => {
    const document = view.documents.find(existing => existing.id === id);
    if (!document) throw new Error("공문을 찾을 수 없습니다.");
    const linked = view.careers.filter(career => career.documentIds.includes(id));
    if (linked.length > 398) throw new Error("이 공문에 연결된 경력이 너무 많습니다. 일부 경력의 연결을 먼저 해제해 주세요.");
    for (const career of linked) tx.set(row(ctx, version, "careers", career.id), normalizeCareer({ documentIds: career.documentIds.filter(existing => existing !== id) }, career));
    tx.delete(row(ctx, version, "documents", id));
    return { value: linkedDocument(document, view.careers), changed: true };
  });
}
export async function linkFreeDocument(documentId: string, careerId: string): Promise<void> {
  if (!validRecordId(documentId) || !validRecordId(careerId)) throw new Error("연결할 기록의 ID가 올바르지 않습니다.");
  return mutate((view, tx, ctx, version) => {
    const career = view.careers.find(existing => existing.id === careerId);
    if (!career || !view.documents.some(document => document.id === documentId)) throw new Error("연결할 경력 또는 공문을 찾을 수 없습니다.");
    if (career.documentIds.includes(documentId)) return { value: undefined, changed: false };
    tx.set(row(ctx, version, "careers", careerId), normalizeCareer({ documentIds: [...career.documentIds, documentId] }, career));
    return { value: undefined, changed: true };
  });
}

/** Staging can fail safely: only the final guarded pointer flip makes data visible. */
export interface ActivationOptions {
  signal?: AbortSignal;
  /** From this point a failed request may already have committed; retain originals. */
  onCommitStarted?: () => void;
}
function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("가져오기를 취소했습니다.", "AbortError");
}
export async function activateRestoredData(
  input: { careers: Career[]; documents: DocumentRecord[] },
  expectedRevision: number,
  expectedActiveVersion?: string,
  options: ActivationOptions = {},
): Promise<void> {
  checkCancellation(options.signal);
  if (!Array.isArray(input.careers) || !Array.isArray(input.documents) || input.careers.length > 100000 || input.documents.length > 10000) throw new Error("복원할 경력 목록이 올바르지 않습니다.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("복원 기준 버전을 확인할 수 없습니다.");
  const careers = input.careers.map(career => normalizeCareer(career));
  const documents = input.documents.map(document => normalizeDocumentRecord(document));
  if (new Set(careers.map(career => career.id)).size !== careers.length || new Set(documents.map(document => document.id)).size !== documents.length) throw new Error("중복된 경력 또는 공문 ID가 포함된 백업입니다.");
  const hashes = new Set<string>();
  for (const document of documents) {
    if (!document.driveFileId || !document.sha256 || hashes.has(document.sha256)) throw new Error("복원할 원본 파일의 드라이브 연결 또는 중복 정보를 확인해 주세요.");
    hashes.add(document.sha256);
  }
  for (const career of careers) checkLinks(career, documents);
  const ctx = await context(), current = await snapshot(ctx);
  checkCancellation(options.signal);
  if (current.revision !== expectedRevision || expectedActiveVersion !== undefined && current.activeVersion !== expectedActiveVersion) throw new ArchiveRevisionConflictError();
  const version = crypto.randomUUID();
  const pending = [
    ...careers.map(career => ({ reference: row(ctx, version, "careers", career.id), data: career })),
    ...documents.map(document => ({ reference: row(ctx, version, "documents", document.id), data: documentMetadata(document) })),
  ];
  for (let offset = 0; offset < pending.length; offset += 400) {
    checkCancellation(options.signal);
    const batch = writeBatch(ctx.db);
    for (const item of pending.slice(offset, offset + 400)) batch.set(item.reference, item.data);
    await batch.commit();
  }
  checkCancellation(options.signal);
  options.onCommitStarted?.();
  // Firestore may invoke this callback repeatedly. Once any attempt can write,
  // a later callback error does not establish that every earlier commit failed.
  let mayHaveCommitted = false;
  await runTransaction(ctx.db, async tx => {
    const actual = rootState((await tx.get(ctx.root)).data());
    if (!sameRoot(actual, current) || actual.revision !== expectedRevision) {
      if (!mayHaveCommitted) throw new ArchiveRevisionConflictError();
      throw conflict();
    }
    mayHaveCommitted = true;
    tx.set(ctx.root, { activeVersion: version, revision: nextRevision(actual.revision) }, { merge: true });
  });
}
