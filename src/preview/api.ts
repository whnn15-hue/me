import { emptyWorkspace, mergeWorkspaceData, mutateWorkspace, normalizeWorkspace } from "../../shared/workspace.mjs";
import type { Career, DocumentRecord } from "../types";
import type { WorkspaceData } from "../workspace/types";
import { extractBrief } from "../reuse/files";
import { normalizeCareer, normalizeDocumentRecord } from "../free/normalize";

interface State { careers: Career[]; documents: DocumentRecord[]; workspace: WorkspaceData; }
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("record-room-isolated-preview-v1", 1);
  request.onupgradeneeded = () => { request.result.createObjectStore("state"); request.result.createObjectStore("files"); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error("브라우저 저장 공간을 열지 못했습니다."));
});
function seed(): State {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return { careers: [{ id: "demo-career", title: "미리보기용 수업 나눔", category: "강의·연수", organization: "예시 교육연구회", role: "발표자", startDate: "2026-01-01", endDate: "", datePrecision: "day", description: "실제 경력과 무관한 테스트 기록입니다.", tags: ["미리보기"], verified: true, evidenceStatus: "later", documentIds: [] }], documents: [],
    workspace: normalizeWorkspace({ ...emptyWorkspace(), items: [{ id: "demo-project", kind: "project", title: "미리보기용 우리 동네 탐구", tags: ["미리보기"], createdAt: timestamp, updatedAt: timestamp }] }) };
}
async function transaction<T>(write: boolean, action: (state: State, tx: IDBTransaction) => T): Promise<T> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["state", "files"], write ? "readwrite" : "readonly");
    let result: T, cause: unknown;
    const request = tx.objectStore("state").get("archive");
    request.onsuccess = () => {
      try {
        const state = request.result as State || seed();
        result = action(state, tx);
        if (write) tx.objectStore("state").put(state, "archive");
      } catch (error) { cause = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(cause || tx.error || new Error("미리보기 데이터를 저장하지 못했습니다."));
  });
}
export async function previewOriginal(id: string): Promise<Blob> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files"), request = tx.objectStore("files").get(id);
    request.onsuccess = () => request.result instanceof Blob ? resolve(request.result) : reject(new Error("이 브라우저에 원본이 없습니다. JSON 백업에는 파일 자체가 포함되지 않습니다."));
    request.onerror = () => reject(request.error);
  });
}
export async function previewApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  if (path === "/status") return { mode: "local", user: { name: "미리보기", email: "preview@example.invalid" }, googleConfigured: false, ownerConfigured: true, aiConfigured: false, driveConfigured: false, driveConnected: false, lastBackup: null } as T;
  if (path === "/data") return transaction(false, state => ({ careers: state.careers, documents: state.documents })) as Promise<T>;
  if (path === "/workspace" && method === "GET") return transaction(false, state => state.workspace) as Promise<T>;
  if (path === "/workspace/export") return transaction(false, state => ({ format: "introduce-me-workspace", version: 1, createdAt: new Date().toISOString(), ...state })) as Promise<T>;
  if (path === "/workspace/import" && method === "POST") return transaction(true, state => {
    if (body.expectedRevision !== state.workspace.revision) throw new Error("다른 화면에서 기록이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    const archive = body.archive;
    if (archive?.format !== "introduce-me-workspace" || archive.version !== 1 || JSON.stringify(archive).length > 5 * 1024 * 1024) throw new Error("올바른 JSON 백업 파일을 선택해 주세요.");
    if (!Array.isArray(archive.careers) || !Array.isArray(archive.documents)) throw new Error("백업 목록을 확인해 주세요.");
    const careers = archive.careers.map((row: unknown) => normalizeCareer(row));
    const documents = archive.documents.map((row: unknown) => normalizeDocumentRecord(row));
    const addedCareers = careers.filter((row: Career) => !state.careers.some(old => old.id === row.id));
    const addedDocuments = documents.filter((row: DocumentRecord) => !state.documents.some(old => old.id === row.id));
    const mergedCareers = [...state.careers, ...addedCareers];
    const result = mergeWorkspaceData(state.workspace, archive.workspace, mergedCareers);
    state.careers = mergedCareers; state.documents.push(...addedDocuments);
    state.workspace = { ...result.workspace, revision: state.workspace.revision + 1 };
    return { ...result, workspace: state.workspace, added: { ...result.added, careers: addedCareers.length, documents: addedDocuments.length } };
  }) as Promise<T>;
  const item = /^\/workspace\/items(?:\/([^/]+))?$/.exec(path);
  if (item && ["POST", "PUT", "DELETE"].includes(method)) return transaction(true, state => {
    state.workspace = mutateWorkspace(state.workspace, { ...body, id: item[1], operation: method === "POST" ? "create" : method === "PUT" ? "update" : "delete" }, state.careers);
    return state.workspace;
  }) as Promise<T>;
  if (path === "/documents" && method === "POST" && options.body instanceof FormData) {
    const files = options.body.getAll("files");
    if (!files.length || files.length > 10) throw new Error("한 번에 파일 10개까지 선택해 주세요.");
    const sources: { file: File; hash: string; text: string }[] = [];
    for (const file of files) {
      if (!(file instanceof File) || !file.size || file.size > 25 * 1024 * 1024 || !/\.(pdf|txt|hwpx|hwp|docx|png|jpe?g|webp)$/i.test(file.name)) throw new Error("지원하는 25 MB 이하의 파일을 선택해 주세요.");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(value => value.toString(16).padStart(2,"0")).join("");
      const text = await extractBrief(file).catch(() => "");
      sources.push({ file, hash, text });
    }
    return transaction(true, (state, tx) => {
      const documents: DocumentRecord[] = [], duplicates: string[] = [];
      for (const { file, hash, text } of sources) {
        const old = state.documents.find(row => row.sha256 === hash);
        if (old) { documents.push(old); duplicates.push(file.name); tx.objectStore("files").put(file, old.id); continue; }
        const document: DocumentRecord = { id: crypto.randomUUID(), name: file.name.normalize("NFC"), mime: file.type, size: file.size, sha256: hash, text, createdAt: new Date().toISOString(), recordIds: [] };
        state.documents.push(document); documents.push(document); tx.objectStore("files").put(file, document.id);
      }
      return { documents, duplicates };
    }) as Promise<T>;
  }
  throw new Error("이 기능은 미리보기에서 실제 서버에 연결하지 않습니다. 사진 보관함과 공모전 제출본을 확인해 주세요.");
}
