import {
  collection, doc, getDocFromServer, getDocsFromServer, getFirestore,
  runTransaction, writeBatch, type DocumentReference, type Firestore, type Transaction,
} from "firebase/firestore";
import { getFirebaseApp, readyCloudUser } from "../cloud";
import { type Career, type DocumentRecord } from "../types";
import { normalizeCareer, normalizeDocumentRecord, validRecordId } from "./normalize";
import { emptyWorkspace, isWorkspaceMetadataRow, mergeWorkspaceData, mutateWorkspace, normalizeWorkspace, translateWorkspaceOriginals, workspaceFromRows, workspaceToRows, type WorkspaceMetadataRow } from "../../shared/workspace.mjs";
import type { WorkspaceArchive, WorkspaceData, WorkspaceImportResult, WorkspaceItem } from "../workspace/types";

export interface FreeSnapshot {
  careers: Career[];
  documents: DocumentRecord[];
  revision: number;
  activeVersion: string;
  workspace: WorkspaceData;
  workspaceVersion: string;
  workspaceRows: WorkspaceMetadataRow[];
  rawCareers: Record<string, unknown>[];
  rawDocuments: Record<string, unknown>[];
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
const WORKSPACE_POINTER_VERSION = "workspace_v1";
const WORKSPACE_POINTER_ID = "__workspace_pointer_v1";
function workspacePointer(ctx: Context) { return row(ctx, WORKSPACE_POINTER_VERSION, "documents", WORKSPACE_POINTER_ID); }
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
    let workspaceRows: WorkspaceMetadataRow[] = [], workspaceVersion = "";
    let rawCareers: Record<string, unknown>[] = [], rawDocuments: Record<string, unknown>[] = [];
    if (before.activeVersion) {
      const [careerQuery, documentQuery] = await Promise.all([
        getDocsFromServer(collection(ctx.root, "versions", before.activeVersion, "careers")),
        getDocsFromServer(collection(ctx.root, "versions", before.activeVersion, "documents")),
      ]);
      rawCareers = careerQuery.docs.map(item => {
        const data = item.data();
        if (data.id !== item.id) throw new Error("경력 ID와 저장 위치가 일치하지 않습니다.");
        return data;
      });
      careers = rawCareers.map(data => normalizeCareer(data));
      rawDocuments = documentQuery.docs.map(item => {
        const data = item.data();
        if (data.id !== item.id) throw new Error("공문 ID와 저장 위치가 일치하지 않습니다.");
        return data;
      });
      documents = rawDocuments.map(data => normalizeDocumentRecord(data));
    }
    const pointer = (await getDocFromServer(workspacePointer(ctx))).data();
    if (pointer !== undefined) {
      if (pointer.id !== WORKSPACE_POINTER_ID || pointer.rowKind !== "introduce-me-workspace" || pointer.schemaVersion !== 1
        || typeof pointer.activeVersion !== "string" || !/^workspace_[A-Za-z0-9_-]{1,80}$/.test(pointer.activeVersion)) throw new Error("학습 기록의 저장 버전을 확인할 수 없습니다.");
      const query = await getDocsFromServer(collection(ctx.root, "versions", pointer.activeVersion, "documents"));
      workspaceVersion = pointer.activeVersion;
      workspaceRows = query.docs.map(item => {
        const data = item.data();
        if (data.id !== item.id || !isWorkspaceMetadataRow(data)) throw new Error("학습 기록의 저장 위치가 올바르지 않습니다.");
        return data as WorkspaceMetadataRow;
      });
    }
    const after = rootState((await getDocFromServer(ctx.root)).data());
    if (sameRoot(before, after)) {
      if (workspaceVersion && !workspaceRows.length) throw new Error("학습 기록의 저장 목록이 누락되었습니다.");
      for (const career of careers) checkLinks(career, documents);
      const workspace = workspaceFromRows(workspaceRows, careers.map(career => career.id), after.revision);
      return { ...after, careers, documents: documents.map(document => linkedDocument(document, careers)), workspace, workspaceVersion, workspaceRows, rawCareers, rawDocuments };
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
    validateFreeSnapshotBudget([...view.careers, career], view.documents, view.workspace);
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
    validateFreeSnapshotBudget(view.careers.map(item => item.id === id ? career : item), view.documents, view.workspace);
    checkLinks(career, view.documents); tx.set(row(ctx, version, "careers", id), career);
    return { value: career, changed: true };
  });
}
export async function deleteFreeCareer(id: string): Promise<void> {
  if (!validRecordId(id)) throw new Error("경력 ID가 올바르지 않습니다.");
  const ctx = await context(), view = await snapshot(ctx);
  if (!view.careers.some(career => career.id === id)) throw new Error("경력을 찾을 수 없습니다.");
  const careers = view.careers.filter(career => career.id !== id);
  const workspace = normalizeWorkspace(view.workspace, { careerIds: careers.map(career => career.id), revision: nextRevision(view.revision), pruneMissingCareerLinks: true });
  await commitWorkspaceChange(ctx, view, workspace, { deleteCareerId: id, allowOversizeDelete: true });
}
export async function addFreeDocument(input: DocumentRecord): Promise<{ document: DocumentRecord; duplicate: boolean }> {
  const document = normalizeDocumentRecord(input);
  if (!document.driveFileId || !document.sha256) throw new Error("공문을 구글 드라이브에 보관한 뒤 등록해 주세요.");
  return mutate<{ document: DocumentRecord; duplicate: boolean }>((view, tx, ctx, version) => {
    const duplicate = view.documents.find(existing => existing.sha256 === document.sha256);
    if (duplicate) return { value: { document: linkedDocument(duplicate, view.careers), duplicate: true }, changed: false };
    if (view.documents.some(existing => existing.id === document.id)) throw new Error("이미 사용 중인 공문 ID입니다.");
    validateFreeSnapshotBudget(view.careers, [...view.documents, document], view.workspace);
    tx.set(row(ctx, version, "documents", document.id), documentMetadata(document));
    return { value: { document: linkedDocument(document, view.careers), duplicate: false }, changed: true };
  });
}
export async function deleteFreeDocument(id: string): Promise<DocumentRecord> {
  if (!validRecordId(id)) throw new Error("공문 ID가 올바르지 않습니다.");
  return mutate((view, tx, ctx, version) => {
    const document = view.documents.find(existing => existing.id === id);
    if (!document) throw new Error("공문을 찾을 수 없습니다.");
    if (view.workspace.items.some(item => item.kind === "photo" && item.documentId === id || item.kind === "submission" && item.documentIds.includes(id))) throw new Error("사진 보관함 또는 제출본에서 사용 중인 원본입니다. 해당 연결을 먼저 해제해 주세요.");
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
    const linked = normalizeCareer({ documentIds: [...career.documentIds, documentId] }, career);
    validateFreeSnapshotBudget(view.careers.map(item => item.id === careerId ? linked : item), view.documents, view.workspace);
    tx.set(row(ctx, version, "careers", careerId), linked);
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
  input: { careers: Career[]; documents: DocumentRecord[]; workspace?: WorkspaceData },
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
  const workspace = normalizeWorkspace(input.workspace ?? current.workspace, {
    careerIds: careers.map(career => career.id), revision: nextRevision(current.revision),
    pruneMissingCareerLinks: input.workspace === undefined,
  });
  const changedWorkspace = JSON.stringify({ items: workspace.items, links: workspace.links }) !== JSON.stringify({ items: current.workspace.items, links: current.workspace.links });
  validateFreeSnapshotBudget(careers, documents, workspace);
  const workspaceVersion = changedWorkspace ? `workspace_${crypto.randomUUID()}` : undefined;
  const version = crypto.randomUUID();
  const rawCareers = new Map(current.rawCareers.map(item => [item.id, item]));
  const rawDocuments = new Map(current.rawDocuments.map(item => [item.id, item]));
  const pending = [
    ...careers.map(career => ({ reference: row(ctx, version, "careers", career.id), data: { ...rawCareers.get(career.id), ...career } })),
    ...documents.map(document => ({ reference: row(ctx, version, "documents", document.id), data: { ...rawDocuments.get(document.id), ...documentMetadata(document) } })),
    ...(workspaceVersion ? workspaceToRows(workspace).map(data => ({ reference: row(ctx, workspaceVersion, "documents", data.id), data })) : []),
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
    if (workspaceVersion) tx.set(workspacePointer(ctx), pointerMetadata(workspaceVersion));
  });
}

function pointerMetadata(activeVersion: string) {
  return { id: WORKSPACE_POINTER_ID, rowKind: "introduce-me-workspace", schemaVersion: 1, activeVersion };
}
function requireRevision(value: unknown, current: number): asserts value is number {
  if (!Number.isSafeInteger(value) || value !== current) throw Object.assign(new ArchiveRevisionConflictError(), { status: 409 });
}
export async function readFreeWorkspace(): Promise<WorkspaceData> { return (await readFreeSnapshot()).workspace; }
export function validateFreeSnapshotBudget(careers: Career[], documents: DocumentRecord[], workspace: WorkspaceData) {
  const encoder = new TextEncoder(), links = new Map<string, string[]>();
  for (const career of careers) {
    if (encoder.encode(JSON.stringify(career)).byteLength > 128 * 1024) throw Object.assign(new Error("경력 한 건의 저장 정보가 복원 가능한 크기를 초과합니다."), { status: 413 });
    for (const id of career.documentIds) {
      const selected = links.get(id) || []; selected.push(career.id); links.set(id, selected);
    }
  }
  for (const document of documents) {
    if (encoder.encode(JSON.stringify({ ...document, recordIds: links.get(document.id) || [] })).byteLength > 128 * 1024)
      throw Object.assign(new Error("공문 한 건의 연결 정보가 복원 가능한 크기를 초과합니다."), { status: 413 });
  }
  const metadata = documents.map(({ recordIds: _links, ...item }) => ({ ...item, recordIds: links.get(item.id) || [] }));
  const payload = { schemaVersion: 1, items: workspace.items, links: workspace.links };
  const createdAt = new Date().toISOString();
  const archive = { format: "introduce-me-workspace", version: 1, createdAt, careers, documents: metadata, workspace: payload };
  const zip = { format: "career-archive", version: 1, createdAt, careers,
    documents: metadata.map(item => ({ ...item, filePath: `originals/${item.id}.${item.name.split(".").at(-1)?.toLowerCase() || "txt"}` })), workspace: payload };
  const snapshot = { format: "career-drive-snapshot", version: 1, createdAt, careers,
    documents: metadata.map(({ recordIds: _links, ...item }) => item), workspace: payload };
  if ([archive, zip, snapshot].some(value => encoder.encode(JSON.stringify(value)).byteLength > 5 * 1024 * 1024))
    throw Object.assign(new Error("전체 경력과 학습 기록이 자동 백업 크기인 5 MB를 초과합니다."), { status: 413 });
}
function stableMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableMetadata);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stableMetadata(item)]));
  return value;
}
function metadataEqual(first: unknown, second: unknown) { return JSON.stringify(stableMetadata(first)) === JSON.stringify(stableMetadata(second)); }
async function stageRows(ctx: Context, version: string, kind: "careers" | "documents", rows: (Record<string, unknown> | Career)[]) {
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = writeBatch(ctx.db);
    for (const data of rows.slice(offset, offset + 400)) batch.set(row(ctx, version, kind, data.id as string), { ...data });
    await batch.commit();
  }
}
/** Cleanup never touches a current namespace and is bounded to 1,000 rows. */
async function cleanupWorkspaceVersion(ctx: Context, version: string) {
  if (!/^workspace_[a-f0-9-]{36}$/.test(version)) return;
  try {
    const pointer = (await getDocFromServer(workspacePointer(ctx))).data();
    if (pointer?.activeVersion === version) return;
    const query = await getDocsFromServer(collection(ctx.root, "versions", version, "documents"));
    if (query.docs.length > 1000 || query.docs.some(item => item.data().id !== item.id || !isWorkspaceMetadataRow(item.data()))) return;
    for (let offset = 0; offset < query.docs.length; offset += 400) {
      const selected = query.docs.slice(offset, offset + 400);
      await runTransaction(ctx.db, async tx => {
        const current = (await tx.get(workspacePointer(ctx))).data();
        if (current?.activeVersion === version) return;
        for (const item of selected) tx.delete(row(ctx, version, "documents", item.id));
      });
    }
  } catch { /* A cleanup failure leaves invisible metadata for later maintenance. */ }
}
async function commitWorkspaceChange(
  ctx: Context, view: FreeSnapshot, input: WorkspaceData,
  changes: { newCareers?: Career[]; newDocuments?: DocumentRecord[]; deleteCareerId?: string; allowOversizeDelete?: boolean } = {},
): Promise<WorkspaceData> {
  const newCareers = changes.newCareers || [];
  const newDocuments = changes.newDocuments || [];
  const careers = [...view.careers.filter(item => item.id !== changes.deleteCareerId), ...newCareers];
  const documents = [...view.documents, ...newDocuments];
  const workspace = normalizeWorkspace(input, { careerIds: careers.map(item => item.id), revision: nextRevision(view.revision) });
  if (!changes.allowOversizeDelete || newCareers.length || newDocuments.length) validateFreeSnapshotBudget(careers, documents, workspace);
  const oldRows = new Map(view.workspaceRows.map(item => [item.id, item]));
  const nextRows = workspaceToRows(workspace);
  const nextIds = new Set(nextRows.map(item => item.id));
  const changed = nextRows.filter(item => !metadataEqual(oldRows.get(item.id), item));
  const removed = [...oldRows.keys()].filter(id => !nextIds.has(id));
  const hasWorkspaceChange = view.workspaceVersion ? changed.length + removed.length > 0 : workspace.items.length + workspace.links.length > 0;
  const stageWorkspace = hasWorkspaceChange && (!view.workspaceVersion || changed.length + removed.length + newCareers.length + newDocuments.length + Number(Boolean(changes.deleteCareerId)) > 400);
  const workspaceVersion = stageWorkspace ? `workspace_${crypto.randomUUID()}` : view.workspaceVersion;
  const stageCareer = newCareers.length + newDocuments.length + Number(Boolean(changes.deleteCareerId)) > 400;
  const careerVersion = stageCareer ? crypto.randomUUID() : view.activeVersion || crypto.randomUUID();
  try {
    if (stageWorkspace) await stageRows(ctx, workspaceVersion, "documents", nextRows);
    if (stageCareer) {
      const rawCareers = view.rawCareers.filter(item => item.id !== changes.deleteCareerId);
      await stageRows(ctx, careerVersion, "careers", [...rawCareers, ...newCareers]);
      await stageRows(ctx, careerVersion, "documents", [...view.rawDocuments, ...newDocuments.map(documentMetadata)]);
    }
    await runTransaction(ctx.db, async tx => {
      const actual = rootState((await tx.get(ctx.root)).data());
      const pointer = (await tx.get(workspacePointer(ctx))).data();
      if (!sameRoot(actual, view) || (pointer?.activeVersion || "") !== view.workspaceVersion)
        throw Object.assign(new ArchiveRevisionConflictError(), { status: 409 });
      if (stageWorkspace) tx.set(workspacePointer(ctx), pointerMetadata(workspaceVersion));
      else if (hasWorkspaceChange) {
        for (const data of changed) tx.set(row(ctx, workspaceVersion, "documents", data.id), data);
        for (const id of removed) tx.delete(row(ctx, workspaceVersion, "documents", id));
      }
      if (!stageCareer) {
        for (const career of newCareers) tx.set(row(ctx, careerVersion, "careers", career.id), career);
        for (const document of newDocuments) tx.set(row(ctx, careerVersion, "documents", document.id), documentMetadata(document));
        if (changes.deleteCareerId) tx.delete(row(ctx, careerVersion, "careers", changes.deleteCareerId));
      }
      tx.set(ctx.root, { activeVersion: careerVersion, revision: workspace.revision }, { merge: true });
    });
  } catch (error) {
    if (stageWorkspace) await cleanupWorkspaceVersion(ctx, workspaceVersion);
    throw error;
  }
  if (stageWorkspace && view.workspaceVersion) await cleanupWorkspaceVersion(ctx, view.workspaceVersion);
  return workspace;
}
export async function mutateFreeWorkspace(operation: "create" | "update" | "delete", body: Record<string, unknown>, id?: string): Promise<WorkspaceData> {
  const ctx = await context(), view = await snapshot(ctx);
  requireRevision(body.expectedRevision, view.revision);
  const workspace = mutateWorkspace(view.workspace, { operation, id, item: body.item, links: body.links as string[], expectedRevision: view.revision }, view.careers);
  return commitWorkspaceChange(ctx, view, workspace, { allowOversizeDelete: operation === "delete" });
}

/** Routine file registration writes only new material rows, never copies the archive. */
export async function appendFreeWorkspaceItems(
  items: WorkspaceItem[], expectedRevision: number, expectedActiveVersion: string,
  options: ActivationOptions = {},
): Promise<void> {
  checkCancellation(options.signal);
  if (!Array.isArray(items) || !items.length || items.length > 350) throw new Error("한 번에 추가할 자료 목록을 확인해 주세요.");
  const ctx = await context(), view = await snapshot(ctx);
  requireRevision(expectedRevision, view.revision);
  if (expectedActiveVersion !== view.activeVersion) throw new ArchiveRevisionConflictError();
  const ids = new Set(items.map(item => item.id));
  if (ids.size !== items.length || view.workspace.items.some(item => ids.has(item.id))) throw new ArchiveRevisionConflictError();
  const workspace = normalizeWorkspace({ ...view.workspace, items: [...view.workspace.items, ...items] }, {
    careerIds: view.careers.map(career => career.id), revision: nextRevision(view.revision),
  });
  validateFreeSnapshotBudget(view.careers, view.documents, workspace);
  const existingRows = new Set(view.workspaceRows.map(row => row.id));
  const previousMeta = view.workspaceRows.find(row => row.rowType === "meta");
  const additions = workspaceToRows(workspace).filter(row => row.rowType === "meta" || !existingRows.has(row.id))
    .map(row => row.rowType === "meta" ? { ...previousMeta, ...row } : row);
  if (additions.length > 398) throw new Error("한 번에 저장할 자료가 너무 많습니다.");
  const version = view.workspaceVersion || `workspace_${crypto.randomUUID()}`;
  const careerVersion = view.activeVersion || crypto.randomUUID();
  let mayHaveCommitted = false;
  await runTransaction(ctx.db, async tx => {
    const actual = rootState((await tx.get(ctx.root)).data());
    const pointer = (await tx.get(workspacePointer(ctx))).data();
    checkCancellation(options.signal);
    if (!sameRoot(actual, view) || (pointer?.activeVersion || "") !== view.workspaceVersion) {
      if (!mayHaveCommitted) throw new ArchiveRevisionConflictError();
      throw conflict();
    }
    mayHaveCommitted = true;
    options.onCommitStarted?.();
    for (const data of additions) tx.set(row(ctx, version, "documents", data.id), data);
    if (!view.workspaceVersion) tx.set(workspacePointer(ctx), pointerMetadata(version));
    tx.set(ctx.root, { activeVersion: careerVersion, revision: workspace.revision }, { merge: true });
  });
}
export async function exportFreeWorkspace(): Promise<WorkspaceArchive> {
  const view = await readFreeSnapshot();
  validateFreeSnapshotBudget(view.careers, view.documents, view.workspace);
  const { revision: _revision, ...workspace } = view.workspace;
  return { format: "introduce-me-workspace", version: 1, createdAt: new Date().toISOString(), careers: view.careers, documents: view.documents, workspace };
}
export async function importFreeWorkspace(body: Record<string, unknown>, options: { verifyOriginal?: (document: DocumentRecord) => Promise<void> } = {}): Promise<WorkspaceImportResult> {
  const ctx = await context(), view = await snapshot(ctx); requireRevision(body.expectedRevision, view.revision);
  const archive = body.archive as Record<string, unknown>;
  if (!archive || typeof archive !== "object" || Array.isArray(archive)
    || !["introduce-me-workspace", "career-archive", "career-drive-snapshot", undefined].includes(archive.format as string | undefined)
    || archive.version !== undefined && archive.version !== 1 || !Array.isArray(archive.careers)
    || archive.careers.length > 100000 || archive.documents !== undefined && !Array.isArray(archive.documents)) throw new Error("가져올 JSON 기록의 형식이 올바르지 않습니다.");
  if (new TextEncoder().encode(JSON.stringify(archive)).byteLength > 5 * 1024 * 1024) throw new Error("가져올 JSON은 5 MB 이하여야 합니다.");
  if (archive.format === "introduce-me-workspace" && archive.workspace === undefined) throw new Error("JSON의 학습 기록을 찾을 수 없습니다.");
  const importedCareers = archive.careers.map(item => {
    if (!item || typeof item !== "object" || !validRecordId(item.id) || !Array.isArray(item.documentIds)) throw new Error("가져올 경력의 ID와 증빙 연결을 확인해 주세요.");
    return normalizeCareer({ ...item, verified: item.verified ?? false });
  });
  for (const item of (archive.documents as Record<string, unknown>[] | undefined ?? [])) {
    if (!item || typeof item !== "object" || Object.hasOwn(item, "storageName") || Object.hasOwn(item, "filePath")
      || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("JSON의 공문 원본 정보가 올바르지 않습니다. 원본 복원에는 ZIP을 사용해 주세요.");
  }
  const importedDocuments = (archive.documents as unknown[] | undefined ?? []).map(normalizeDocumentRecord);
  if (importedDocuments.length > 10000 || new Set(importedCareers.map(item => item.id)).size !== importedCareers.length
    || new Set(importedDocuments.map(item => item.id)).size !== importedDocuments.length
    || new Set(importedDocuments.map(item => item.sha256)).size !== importedDocuments.length) throw new Error("중복되거나 너무 많은 경력, 공문이 포함된 JSON입니다.");
  const conflicts: WorkspaceImportResult["conflicts"] = [];
  const careers = [...view.careers], documents = [...view.documents];
  const careerMap = new Map(careers.map(item => [item.id, item])), documentMap = new Map(documents.map(item => [item.id, item]));
  const hashes = new Map(documents.map(item => [item.sha256, item]));
  const translation = new Map<string, string>();
  const newDocuments: DocumentRecord[] = [];
  for (const item of importedDocuments) {
    const previous = documentMap.get(item.id), sameBytes = hashes.get(item.sha256);
    if (previous) {
      if (!item.sha256 || previous.sha256 !== item.sha256 || previous.size !== item.size) conflicts.push({ ref: `document:${item.id}`, reason: "현재 공문 원본을 유지했습니다." });
      else {
        translation.set(item.id, previous.id);
        if (JSON.stringify(normalizeDocumentRecord(previous)) !== JSON.stringify(item)) conflicts.push({ ref: `document:${item.id}`, reason: "현재 공문 파일명과 설명을 유지했습니다." });
      }
    } else if (sameBytes && sameBytes.size === item.size) translation.set(item.id, sameBytes.id);
    else if (!sameBytes && item.driveFileId && options.verifyOriginal) {
      // Reading the Drive original verifies account, folder, kind, length and SHA.
      // Complete every verification before touching any Firestore metadata.
      try { await options.verifyOriginal(item); }
      catch { throw new Error(`${item.name}: 본인 드라이브 원본의 권한과 크기, SHA-256을 확인하지 못했습니다. 기록은 변경하지 않았습니다.`); }
      documents.push(item); documentMap.set(item.id, item); hashes.set(item.sha256, item);
      newDocuments.push(item); translation.set(item.id, item.id);
    }
    else {
      // A JSON URL alone does not prove that an original belongs to this archive.
      conflicts.push({ ref: `document:${item.id}`, reason: "보관함에 없는 원본은 기존 ZIP 가져오기로 추가해 주세요." });
    }
  }
  let addedCareers = 0;
  for (const item of importedCareers) {
    const previous = careerMap.get(item.id);
    if (previous) { if (JSON.stringify(previous) !== JSON.stringify(item)) conflicts.push({ ref: `career:${item.id}`, reason: "현재 경력 내용을 유지했습니다." }); }
    else {
      const documentIds = item.documentIds.map(id => translation.get(id) ?? (documentMap.has(id) && !importedDocuments.some(item => item.id === id) ? id : "")).filter(Boolean);
      if (documentIds.length !== item.documentIds.length) { conflicts.push({ ref: `career:${item.id}`, reason: "연결할 공문 원본이 없어 이 경력을 추가하지 않았습니다." }); continue; }
      const normalized = normalizeCareer({ ...item, documentIds }); careers.push(normalized); careerMap.set(normalized.id, normalized); addedCareers++;
    }
  }
  const importedWorkspace = normalizeWorkspace(archive.workspace ?? emptyWorkspace(), { careerIds: [...new Set([...view.careers, ...importedCareers].map(item => item.id))] });
  const availableCareers = new Set(careers.map(item => item.id));
  const incomingLinks = importedWorkspace.links.filter(link => {
    const missing = [link.from, link.to].filter(ref => ref.startsWith("career:") && !availableCareers.has(ref.slice(7)));
    for (const ref of missing) conflicts.push({ ref, reason: "추가되지 않은 경력을 가리키는 연결은 가져오지 않았습니다." });
    return !missing.length;
  });
  const translated = translateWorkspaceOriginals({ ...importedWorkspace, links: incomingLinks }, (id, hash) => {
    const mapped = translation.get(id) ?? (importedDocuments.some(item => item.id === id) ? "" : id);
    const document = documentMap.get(mapped);
    return document && (!hash || document.sha256 === hash) ? document.id : undefined;
  });
  const merged = mergeWorkspaceData(view.workspace, translated, careers);
  const result: WorkspaceImportResult = { workspace: merged.workspace, conflicts: [...conflicts, ...merged.conflicts], added: { careers: addedCareers, documents: newDocuments.length, ...merged.added } };
  if (addedCareers || newDocuments.length || merged.added.items || merged.added.links) {
    const existingIds = new Set(view.careers.map(item => item.id));
    result.workspace = await commitWorkspaceChange(ctx, view, merged.workspace, { newCareers: careers.filter(item => !existingIds.has(item.id)), newDocuments });
  }
  return result;
}
