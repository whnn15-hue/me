import type { DocumentRecord } from "../types";
import type { SubmissionItem, WorkspaceData } from "../workspace/types";
import { newSubmission, suggestSceneTags } from "./model";

interface Dependencies {
  validate: (file: File) => Promise<unknown>;
  readWorkspace: () => Promise<WorkspaceData>;
  readDocuments: () => Promise<DocumentRecord[]>;
  upload: (file: File) => Promise<DocumentRecord>;
  save: (item: SubmissionItem, revision: number) => Promise<void>;
  stopped?: () => boolean;
  progress?: (state: { saved: number; duplicates: number; completed: number; total: number; name: string }) => void;
}

/** A drop belongs to the submissions screen, regardless of its filename/content. */
export async function archiveSubmissionFiles(files: File[], dependencies: Dependencies) {
  if (!files.length || files.length > 10) throw new Error("제출 파일은 한 번에 1~10개까지 넣을 수 있어요.");
  if (files.some(file => !file.size || file.size > 25 * 1024 * 1024)
    || files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) {
    throw new Error("비어 있지 않은 파일을 파일당 25 MB, 합계 200 MB까지 넣을 수 있어요.");
  }
  // Validate every selected file before storing the first original.
  for (const file of files) await dependencies.validate(file);
  let saved = 0, duplicates = 0, completed = 0;
  const report = (file: File) => dependencies.progress?.({ saved, duplicates, completed, total: files.length, name: file.name.normalize("NFC") });
  const findExisting = (workspace: WorkspaceData, documents: DocumentRecord[], hash: string) => {
    const ids = new Set(documents.filter(document => document.sha256 === hash).map(document => document.id));
    return workspace.items.find(item => item.kind === "submission" && item.documentIds.some(id => ids.has(id)));
  };
  for (const file of files) {
    if (dependencies.stopped?.()) break;
    report(file);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(value => value.toString(16).padStart(2, "0")).join("");
    let [workspace, documents] = await Promise.all([dependencies.readWorkspace(), dependencies.readDocuments()]);
    if (findExisting(workspace, documents, hash)) { duplicates++; completed++; report(file); continue; }
    let original = documents.find(document => document.sha256 === hash && document.size === file.size);
    if (!original) original = await dependencies.upload(file);
    if (!original?.id || original.size !== file.size || original.sha256 && original.sha256 !== hash) {
      throw new Error("저장된 원본 정보를 확인하지 못했습니다. 원본은 보관함에서 확인해 주세요.");
    }
    // Uploading can change the production revision. Re-read before linking.
    [workspace, documents] = await Promise.all([dependencies.readWorkspace(), dependencies.readDocuments()]);
    if (findExisting(workspace, [...documents, original], hash)) { duplicates++; completed++; report(file); continue; }
    const id = `submission-${hash.slice(0, 32)}`;
    if (workspace.items.some(item => item.id === id)) throw new Error("같은 파일의 기록이 변경되어 자동으로 추가하지 못했습니다. 기존 제출본을 확인해 주세요.");
    const title = file.name.normalize("NFC").replace(/\.[^.]+$/, "").trim().slice(0, 300) || "제출 자료";
    await dependencies.save({ ...newSubmission(), id, title, documentIds: [original.id], tags: suggestSceneTags(title) }, workspace.revision);
    saved++; completed++; report(file);
  }
  return { saved, duplicates, completed };
}
