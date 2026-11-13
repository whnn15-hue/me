import { decodeHtml, isHtmlBytes } from "../../shared/html.mjs";
import { audioName, extraFileTypes, validExtraFile } from "../../shared/resources.mjs";
import type { DocumentRecord } from "../types";
import type { MaterialItem } from "./types";

type ReadOriginal = (document: DocumentRecord) => Promise<Blob>;
async function checkedOriginal(item: MaterialItem, documents: DocumentRecord[], read: ReadOriginal): Promise<Blob | null> {
  const source = item.sourceFile;
  if (!source || source.size <= 0 || source.size > 25 * 1024 * 1024 || !/^[a-f0-9]{64}$/i.test(source.sha256)) throw new Error("원본 파일의 확인 정보를 찾지 못했습니다.");
  const original = documents.find(document => document.sha256 === source.sha256 && document.size === source.size);
  if (!original) return null;
  const blob = await read(original);
  if (blob.size !== source.size) throw new Error("원본 파일의 크기가 기록과 일치하지 않습니다.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== source.sha256.toLowerCase()) throw new Error("원본 파일의 확인 정보가 기록과 일치하지 않습니다.");
  return blob;
}

export async function materialHtmlPreview(item: MaterialItem, documents: DocumentRecord[], read: ReadOriginal, legacy?: () => Promise<string>) {
  if (item.format !== "HTML" || !item.sourceFile || !/\.html?$/i.test(item.sourceFile.name)) throw new Error("앱에 보관한 HTML 자료만 미리 볼 수 있습니다.");
  if (item.sourceFile.size > 2 * 1024 * 1024) throw new Error("미리보기는 2 MB까지 지원합니다. 원본을 내려받아 열어 주세요.");
  const blob = await checkedOriginal(item, documents, read);
  if (!blob) { if (legacy) return legacy(); throw new Error("미리 볼 원본 파일을 찾지 못했습니다."); }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isHtmlBytes(bytes)) throw new Error("HTML 원본의 형식을 확인해 주세요.");
  return decodeHtml(bytes);
}

export async function materialAudioPreview(item: MaterialItem, documents: DocumentRecord[], read: ReadOriginal, legacy?: () => Promise<Blob>) {
  if (!item.sourceFile || !audioName(item.sourceFile.name)) throw new Error("앱에 보관한 오디오만 미리 들을 수 있습니다.");
  const blob = await checkedOriginal(item, documents, read);
  if (!blob) { if (legacy) return legacy(); throw new Error("미리 들을 원본 파일을 찾지 못했습니다."); }
  const extension = item.sourceFile.name.split(".").at(-1)!.toLowerCase();
  if (!validExtraFile(extension, new Uint8Array(await blob.slice(0, 65536).arrayBuffer()))) throw new Error("오디오 원본의 형식을 확인해 주세요.");
  return new Blob([blob], { type: extraFileTypes[extension] });
}
