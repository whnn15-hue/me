import { api } from "../api";
import { type DocumentRecord } from "../types";
import { createBackupBlob, readBackupFile, readDriveSnapshotFile } from "./backup";
import { downloadDriveFile, sha256, uploadDriveFile, trashDriveFile, validateDriveUploadFile } from "./drive";
import {
  activateRestoredData,
  addFreeDocument,
  createFreeCareer,
  deleteFreeCareer,
  deleteFreeDocument,
  linkFreeDocument,
  readFreeData,
  readFreeSnapshot,
  updateFreeCareer,
} from "./store";

function jsonBody(options: RequestInit): Record<string, unknown> {
  try {
    const parsed = JSON.parse(typeof options.body === "string" ? options.body : "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("입력한 경력 정보를 확인해 주세요.");
  }
}

async function uploadDocument(file: File) {
  const mime = await validateDriveUploadFile(file);
  const digest = await sha256(await file.arrayBuffer());
  const data = await readFreeData();
  const duplicate = data.documents.find(document => document.sha256 === digest);
  if (duplicate) return { document: duplicate, duplicate: true };
  const uploaded = await uploadDriveFile(file, "document", digest);
  let extracted: { text?: string; analysisStatus?: string } = {};
  try {
    extracted = await api("/documents/extract", {
      method: "POST",
      body: JSON.stringify({
        driveFileId: uploaded.id,
        name: file.name,
        size: file.size,
        mime,
        sha256: digest,
      }),
    });
  } catch {
    extracted.analysisStatus = "원본을 보관했습니다. 내용 추출은 다시 시도하거나 직접 입력해 주세요.";
  }
  const document: DocumentRecord = {
    id: crypto.randomUUID(),
    name: file.name,
    mime,
    size: file.size,
    createdAt: new Date().toISOString(),
    recordIds: [],
    driveFileId: uploaded.id,
    sha256: digest,
    text: (extracted.text || "").slice(0, 24000),
    analysisStatus: extracted.analysisStatus || "텍스트 추출 완료",
  };
  try {
    const result = await addFreeDocument(document);
    if (result.duplicate) await trashDriveFile(uploaded.id).catch(() => {});
    return result;
  } catch (error) {
    await trashDriveFile(uploaded.id).catch(() => {});
    throw error;
  }
}

async function restoreBackup(file: File) {
  const previous = await readFreeSnapshot();
  if (file.name.toLowerCase().endsWith(".json")) {
    const restored = await readDriveSnapshotFile(file);
    // 원본은 기존 드라이브에 남아 있습니다. 모두 검증한 뒤 데이터만 전환합니다.
    for (const document of restored.documents) {
      await downloadDriveFile(document.driveFileId!, {
        size: document.size,
        sha256: document.sha256,
        kind: "document",
      });
    }
    await activateRestoredData(restored, previous.revision, previous.activeVersion);
    return { ok: true };
  }
  const restored = await readBackupFile(file);
  const uploadedIds: string[] = [];
  const documents: DocumentRecord[] = [];
  try {
    for (const document of restored.documents) {
      const uploaded = await uploadDriveFile(
        new File([new Uint8Array(document.bytes)], document.name, { type: document.mime }),
        "document",
        document.sha256,
      );
      uploadedIds.push(uploaded.id);
      const { bytes, ...metadata } = document;
      documents.push({ ...metadata, driveFileId: uploaded.id });
    }
    await activateRestoredData(
      { careers: restored.careers, documents },
      previous.revision,
      previous.activeVersion,
    );
    return { ok: true };
  } catch (error) {
    // 이번 복원에서 새로 만든 원본만 정리합니다. 기존 원본은 보존합니다.
    for (const id of uploadedIds) await trashDriveFile(id).catch(() => {});
    throw error;
  }
}

async function fullBackup(careerIds?: unknown) {
  const snapshot = await readFreeSnapshot();
  let careers = snapshot.careers;
  if (careerIds !== undefined) {
    if (
      !Array.isArray(careerIds) ||
      !careerIds.length ||
      careerIds.some(id => typeof id !== "string" || !snapshot.careers.some(career => career.id === id))
    )
      throw new Error("증빙을 모을 경력을 선택해 주세요.");
    careers = snapshot.careers.filter(career => careerIds.includes(career.id));
  }
  const ids = new Set(careers.flatMap(career => career.documentIds));
  const source = snapshot.documents.filter(document => careerIds === undefined || ids.has(document.id));
  if (source.reduce((sum, document) => sum + document.size, 0) > 200 * 1024 * 1024)
    throw new Error("전체 백업은 최대 200 MB입니다. 필요한 경력을 선택해 증빙 ZIP으로 나누어 내려받아 주세요.");
  const documents = [];
  for (const document of source) {
    if (!document.driveFileId || !document.sha256)
      throw new Error(`${document.name}: 원본 보관 정보를 확인할 수 없습니다.`);
    const original = await downloadDriveFile(document.driveFileId, {
      size: document.size,
      sha256: document.sha256,
      kind: "document",
    });
    documents.push({ ...document, bytes: new Uint8Array(await original.blob.arrayBuffer()) });
  }
  return { blob: await createBackupBlob({ careers, documents }) };
}

export async function freeApi(
  path: string,
  options: RequestInit,
): Promise<{ handled: boolean; value?: unknown }> {
  const method = (options.method || "GET").toUpperCase();
  if (path === "/backup/export" && method === "GET")
    return { handled: true, value: await fullBackup() };
  if (path === "/resume/evidence" && method === "POST")
    return { handled: true, value: await fullBackup(jsonBody(options).careerIds) };
  if (path === "/data" && method === "GET")
    return { handled: true, value: await readFreeData() };
  if (path === "/careers" && method === "POST")
    return { handled: true, value: await createFreeCareer(jsonBody(options)) };
  const career = /^\/careers\/([^/]+)$/.exec(path);
  if (career && method === "PUT")
    return { handled: true, value: await updateFreeCareer(career[1], jsonBody(options)) };
  if (career && method === "DELETE") {
    await deleteFreeCareer(career[1]);
    return { handled: true, value: { ok: true } };
  }
  if (path === "/documents" && method === "POST") {
    if (!(options.body instanceof FormData)) throw new Error("공문 파일을 선택해 주세요.");
    const files = options.body.getAll("files").filter((file): file is File => file instanceof File);
    if (!files.length || files.length > 10) throw new Error("공문 파일은 한 번에 1~10개까지 선택해 주세요.");
    if (files.some(file => file.size > 25 * 1024 * 1024))
      throw new Error("공문은 파일당 최대 25 MB까지 보관할 수 있습니다.");
    const result: { documents: DocumentRecord[]; duplicates: string[] } = { documents: [], duplicates: [] };
    for (const file of files) {
      const uploaded = await uploadDocument(file);
      result.documents.push(uploaded.document);
      if (uploaded.duplicate) result.duplicates.push(file.name);
    }
    return { handled: true, value: result };
  }
  const linked = /^\/documents\/([^/]+)\/link$/.exec(path);
  if (linked && method === "POST") {
    const body = jsonBody(options);
    await linkFreeDocument(linked[1], String(body.careerId || ""));
    return { handled: true, value: { ok: true } };
  }
  const document = /^\/documents\/([^/]+)$/.exec(path);
  if (document && method === "DELETE") {
    await deleteFreeDocument(document[1]);
    return {
      handled: true,
      value: { ok: true, warning: "앱에서 삭제했습니다. 이전 백업 복원을 위해 드라이브 원본은 보관합니다." },
    };
  }
  const original = /^\/documents\/([^/]+)\/file$/.exec(path);
  if (original && method === "GET") {
    const data = await readFreeData();
    const record = data.documents.find(item => item.id === original[1]);
    if (!record?.driveFileId) throw new Error("공문 원본 파일을 찾을 수 없습니다.");
    return { handled: true, value: {
      driveFileId: record.driveFileId,
      fileName: record.name,
      size: record.size,
      sha256: record.sha256,
      kind: "document",
    } };
  }
  if (path === "/backup/restore" && method === "POST") {
    if (!(options.body instanceof FormData)) throw new Error("복원할 백업 ZIP을 선택해 주세요.");
    const file = options.body.get("file");
    if (!(file instanceof File)) throw new Error("복원할 백업 ZIP을 선택해 주세요.");
    return { handled: true, value: await restoreBackup(file) };
  }
  return { handled: false };
}

const templates = new WeakMap<File, string>();
export async function prepareTemplateRequest(path: string, options: RequestInit) {
  if (!(options.body instanceof FormData) || !/^\/resume\/hwpx\/(inspect|fill)$/.test(path))
    return options;
  const file = options.body.get("file");
  if (!(file instanceof File)) throw new Error("HWPX 양식을 선택해 주세요.");
  let driveFileId = templates.get(file);
  if (!driveFileId) {
    driveFileId = (await uploadDriveFile(file, "template")).id;
    templates.set(file, driveFileId);
  }
  const mappings = options.body.get("mappings");
  return {
    ...options,
    body: JSON.stringify({
      driveFileId,
      templateFileId: driveFileId,
      name: file.name,
      size: file.size,
      ...(typeof mappings === "string" ? { mappings: JSON.parse(mappings) } : {}),
    }),
  };
}
