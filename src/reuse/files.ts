import JSZip from "jszip";
import { readZipText } from "../../shared/zip-text.mjs";
import type { DocumentRecord } from "../types";
import type { SubmissionItem, PhotoItem } from "../workspace/types";
import { loadDocumentBlob } from "../api";
import { safeFilename } from "./model";

export async function extractBrief(file: File): Promise<string> {
  if (!file.size || file.size > 25 * 1024 * 1024) throw new Error("25 MB 이하의 파일을 선택해 주세요.");
  if (/\.txt$/i.test(file.name)) return (await file.text()).slice(0, 30000);
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const pdf = await task.promise;
      let text = "";
      for (let page = 1; page <= Math.min(pdf.numPages, 40) && text.length < 30000; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        text += content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("") + "\n";
      }
      return text.slice(0, 30000);
    } finally { await task.destroy(); }
  }
  if (/\.(hwpx|docx)$/i.test(file.name)) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.values(zip.files).filter(entry => !entry.dir && /^(Contents\/section\d+\.xml|word\/document\.xml)$/.test(entry.name)).sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 30);
    let total = 0, text = "";
    for (const entry of entries) {
      const result = await readZipText(entry, Math.min(1024 * 1024, 4 * 1024 * 1024 - total));
      total += result.byteLength;
      text += result.text.replace(/<\/(?:hp|w):p>/g, "\n").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") + "\n";
      if (total >= 4 * 1024 * 1024 || text.length >= 30000) break;
    }
    return text.slice(0, 30000);
  }
  return "";
}

export async function buildPhotoPackage(submission: SubmissionItem, photos: PhotoItem[], documents: DocumentRecord[]) {
  const selected = submission.slots.filter(slot => slot.photoId);
  if (!selected.length) throw new Error("사진을 한 장 이상 선택해 주세요.");
  const sources = selected.map(slot => {
    const photo = photos.find(item => item.id === slot.photoId), document = documents.find(item => item.id === photo?.documentId);
    if (!photo || !document) throw new Error("연결한 사진 원본이 없습니다. 원본을 복원한 뒤 다시 시도해 주세요.");
    return { slot, photo, document };
  });
  if (sources.reduce((sum, source) => sum + source.document.size, 0) > 200 * 1024 * 1024) throw new Error("사진 묶음은 200 MB 이내로 선택해 주세요.");
  const zip = new JSZip(), index: { file: string; section: string; caption: string }[] = [];
  for (const [order, { slot, document }] of sources.entries()) {
    const bytes = await loadDocumentBlob(document);
    const extension = /\.(jpg|jpeg|png|webp)$/i.exec(document.name)?.[0].toLowerCase();
    if (!extension) throw new Error("사진 원본 형식을 확인해 주세요.");
    const name = `${String(order + 1).padStart(2, "0")}_${safeFilename(slot.title)}${extension}`;
    zip.file(name, await bytes.arrayBuffer());
    index.push({ file: name, section: slot.title, caption: slot.caption });
  }
  zip.file("사진_설명.txt", `${submission.title}\n${submission.competition}\n\n${index.map(item => `${item.file}\n${item.caption || "설명 미입력"}`).join("\n\n")}`);
  zip.file("제출본_기록.json", JSON.stringify({ format: "record-room-photo-selection", version: 1, createdAt: new Date().toISOString(), submission, files: index }, null, 2));
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
