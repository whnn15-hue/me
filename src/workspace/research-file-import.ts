import { materialDraft } from "../../shared/material-classification.mjs";
import { materialLibrary, resourceType, videoResourceTypes, type ResourceType } from "../../shared/resources.mjs";
import { prepareMaterialFiles } from "../free/material-files";
import type { DocumentRecord } from "../types";
import type { MaterialItem, WorkspaceData } from "./types";

type ResearchType = NonNullable<MaterialItem["researchType"]>;
export type DroppedArchiveOptions = {
  purpose: "research" | "classroom" | "lecture";
  schoolSection?: "lesson" | "classroom";
  library?: "learning" | "video";
  resourceType?: ResourceType;
  researchType?: ResearchType;
};
export type DroppedArchiveResult = { added: number; duplicates: number; elsewhere: number; ids: string[] };
export type DroppedArchiveDependencies = {
  readState: () => Promise<{ workspace: WorkspaceData; documents: DocumentRecord[] }>;
  uploadOriginal: (file: File) => Promise<DocumentRecord>;
  /** Creates a new record. This callback must never update an existing item. */
  saveItem: (item: MaterialItem, expectedRevision: number) => Promise<WorkspaceData>;
  onProgress?: (completed: number, total: number) => void;
};

export function validateFileBatch(files: readonly Pick<File, "name" | "size">[]) {
  if (!files.length || files.length > 10) throw new Error("파일은 한 번에 1~10개까지 넣을 수 있습니다.");
  if (files.some(file => !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 25 * 1024 * 1024)) {
    throw new Error("비어 있지 않은 25 MB 이하의 파일을 선택해 주세요. 큰 파일은 드라이브 링크로 추가할 수 있습니다.");
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new Error("한 번에 넣는 자료는 합계 200 MB 이하여야 합니다. 파일을 나누어 넣어 주세요.");
}

const explicit = (text: string, names: string) => text.split(/\r?\n/)
  .find(line => new RegExp(`^\\s*(?:${names})\\s*[:：]`).test(line))?.replace(/^.*?[:：]\s*/, "").trim().slice(0, 300) || "";

/** Source-backed suggestions only; citations in the body never become its year. */
export function researchFileDraft(name: string, text = "", selectedType?: ResearchType): Partial<MaterialItem> {
  const normalizedName = name.normalize("NFC"), normalizedText = text.normalize("NFC").slice(0, 60000);
  const draft = materialDraft(normalizedName, normalizedText, "lecture") as MaterialItem;
  const typeSource = `${normalizedName} ${explicit(normalizedText, "자료 종류|문서 종류")}`;
  const inferred: ResearchType = /부록|증빙|첨부/.test(typeSource) ? "부록·증빙"
    : /참고자료|참고문헌/.test(typeSource) ? "참고자료"
    : /계획서|계획안/.test(typeSource) ? "계획서"
    : /보고서|결과보고|연구보고/.test(typeSource) ? "보고서"
    : /발표|프레젠테이션/i.test(typeSource) || /\.pptx?$/i.test(normalizedName) ? "발표자료" : "기타";
  const yearSource = explicit(normalizedText, "대회연도|대회 연도|연도|학년도|작성연도|제작연도") || normalizedName;
  const year = /(?:^|\D)((?:19|20)\d{2})(?=\D|$)/.exec(yearSource)?.[1] || "";
  const contest = explicit(normalizedText, "대회명|공모전명|연구대회명")
    || /수업혁신사례연구대회|교실수업개선(?:실천)?사례연구대회|교육방송연구대회|현장교육연구대회|교육자료전|[가-힣]{2,20}공모전/.exec(normalizedName)?.[0] || "";
  return { ...draft, purpose: "research", ownership: "created", researchType: selectedType || inferred,
    eventName: contest, date: year, audience: [], resourceType: "lecture" };
}

function sameOriginal(item: MaterialItem, hash: string, size: number) {
  return item.sourceFile?.sha256 === hash && item.sourceFile?.size === size;
}
function sameDestination(item: MaterialItem, options: DroppedArchiveOptions) {
  if ((item.purpose || "lecture") !== options.purpose) return false;
  if (options.purpose === "classroom") return (item.schoolSection || "classroom") === (options.schoolSection || "classroom");
  if (options.purpose === "research") return !options.researchType || (item.researchType || "기타") === options.researchType;
  return materialLibrary(item) === (options.library || "learning") && (!options.resourceType || resourceType(item) === options.resourceType);
}
const matchingMaterial = (workspace: WorkspaceData, hash: string, size: number, options: DroppedArchiveOptions) => workspace.items
  .find((item): item is MaterialItem => item.kind === "material" && sameOriginal(item, hash, size) && sameDestination(item, options));

/**
 * Every file is validated before the first write. Originals and metadata use the
 * existing archive APIs; a failed or ambiguous save never deletes an original.
 * Retrying reads current state and preserves edits and existing folder placement.
 */
export async function archiveDroppedFiles(files: File[], deps: DroppedArchiveDependencies, options: DroppedArchiveOptions): Promise<DroppedArchiveResult> {
  validateFileBatch(files);
  if (options.resourceType && (options.purpose !== "lecture" || options.library !== "video" || !videoResourceTypes.some(type => type.id === options.resourceType))) {
    throw new Error("영상 작업 자료를 보관할 분류를 확인해 주세요.");
  }
  if (options.purpose === "research" && files.some(file => !/\.(pdf|pptx?|hwp|hwpx|docx|html?|txt|xlsx|cell|jpe?g|png|webp)$/i.test(file.name))) {
    throw new Error("연구 자료에는 문서 또는 이미지 파일을 넣어 주세요.");
  }
  const prepared = await prepareMaterialFiles(files, options.purpose === "classroom" ? "classroom" : "lecture");
  const result: DroppedArchiveResult = { added: 0, duplicates: files.length - prepared.documents.length, elsewhere: 0, ids: [] };
  const addDuplicate = (item: MaterialItem) => { result.duplicates++; result.ids.push(item.id); };
  for (const [index, source] of prepared.documents.entries()) {
    deps.onProgress?.(index, prepared.documents.length);
    try {
      let state = await deps.readState();
      const existing = matchingMaterial(state.workspace, source.sha256, source.size, options);
      if (existing) { addDuplicate(existing); continue; }
      const entry = prepared.materials.find(value => value.documentId === source.id)!;
      const sourceBytes = source.bytes.slice().buffer as ArrayBuffer;
      const document = state.documents.find(doc => doc.sha256 === source.sha256 && doc.size === source.size);
      // Older material imports can own a stored link without a DocumentRecord.
      // Share that existing original, while creating a distinct folder entry.
      const linkedOriginal = !document ? state.workspace.items.find((item): item is MaterialItem =>
        item.kind === "material" && sameOriginal(item, source.sha256, source.size) && Boolean(item.fileUrl)) : undefined;
      const original: Pick<DocumentRecord, "name" | "size" | "sha256" | "text"> = document || (linkedOriginal?.sourceFile ? linkedOriginal.sourceFile
        : await deps.uploadOriginal(new File([sourceBytes], source.name, { type: source.mime })));
      if (original.sha256 !== source.sha256 || original.size !== source.size) throw new Error("보관한 원본의 확인 정보가 일치하지 않습니다.");
      // Uploading can take time. Refresh metadata immediately before creating it.
      state = await deps.readState();
      const concurrent = matchingMaterial(state.workspace, source.sha256, source.size, options);
      if (concurrent) { addDuplicate(concurrent); continue; }
      const extracted = original.text?.trim() || "";
      const base = extracted ? materialDraft(source.name, extracted, options.purpose === "classroom" ? "classroom" : "lecture") as MaterialItem : entry.item;
      const research = options.purpose === "research" ? researchFileDraft(source.name, extracted, options.researchType) : {};
      const inferred = resourceType(base);
      // The visible folder wins over filename suggestions, including audio files.
      const selectedResource = options.purpose === "lecture" && options.library === "video"
        ? options.resourceType || (videoResourceTypes.some(type => type.id === inferred) ? inferred : "template") : "lecture";
      const item: MaterialItem = { ...base, ...research, id: "", purpose: options.purpose, resourceType: selectedResource,
        ...(options.purpose === "classroom" ? { schoolSection: options.schoolSection || "classroom" } : {}),
        title: options.purpose === "research" && !extracted ? entry.item.title : (research.title || base.title),
        summary: extracted ? (research.summary ?? base.summary) : entry.item.summary,
        author: extracted ? (research.author ?? base.author) : entry.item.author,
        fileUrl: linkedOriginal?.fileUrl || "",
        sourceFile: { name: original.name, size: original.size, sha256: original.sha256 },
        createdAt: entry.item.createdAt, updatedAt: entry.item.updatedAt };
      let next: WorkspaceData;
      try { next = await deps.saveItem(item, state.workspace.revision); }
      catch (cause) {
        // A response may be lost after a committed create. Read, never replay it.
        const after = await deps.readState().catch(() => null);
        const committed = after && matchingMaterial(after.workspace, source.sha256, source.size, options);
        if (committed) { addDuplicate(committed); continue; }
        throw cause;
      }
      const saved = matchingMaterial(next, source.sha256, source.size, options);
      if (!saved) throw new Error("저장한 연구 자료를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
      result.added++; result.ids.push(saved.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "자료를 저장하지 못했습니다.";
      throw new Error(`${source.name}: ${message}${result.added ? ` 앞서 저장한 ${result.added}개 자료는 그대로 보관했습니다.` : ""}`);
    }
  }
  deps.onProgress?.(prepared.documents.length, prepared.documents.length);
  return { ...result, ids: [...new Set(result.ids)] };
}
