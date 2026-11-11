import JSZip from "jszip";
import { decodeHtml, htmlMetadata } from "../../shared/html.mjs";
import { readZipText } from "../../shared/zip-text.mjs";
import { materialDraft } from "../../shared/material-classification.mjs";
import { sha256, validateDriveUploadFile } from "./drive";
import type { PreparedMaterialImport } from "./material-import";

/** Local drafts are ready immediately; server extraction can enrich them after upload. */
export async function prepareMaterialFiles(files: File[], purpose: "lecture" | "classroom"): Promise<PreparedMaterialImport> {
  if (!files.length || files.length > 10) throw new Error("파일은 한 번에 1~10개까지 넣을 수 있습니다.");
  if (files.some(file => !file.size || file.size > 25 * 1024 * 1024)) throw new Error("비어 있지 않은 25 MB 이하의 파일을 선택해 주세요. 큰 파일은 드라이브에 올린 뒤 링크로 추가할 수 있습니다.");
  if (files.reduce((total,file)=>total+file.size,0)>200*1024*1024) throw new Error("한 번에 넣는 자료는 합계 200 MB 이하여야 합니다. 파일을 나누어 넣어 주세요.");
  const materials: PreparedMaterialImport["materials"] = [], documents: PreparedMaterialImport["documents"] = [];
  const hashes = new Set<string>(), now = new Date().toISOString();
  for (const file of files) {
    const mime = await validateDriveUploadFile(file);
    const bytes = new Uint8Array(await file.arrayBuffer()), digest = await sha256(bytes);
    if (hashes.has(digest)) continue;
    hashes.add(digest);
    let text = "";
    const html = /\.html?$/i.test(file.name) ? htmlMetadata(decodeHtml(bytes.subarray(0, 1024 * 1024))) : undefined;
    if (/\.txt$/i.test(file.name)) text = (await file.text()).slice(0, 60000);
    else if (/\.(pptx|potx|docx|dotx|hwpx)$/i.test(file.name)) {
      try {
        const zip = await JSZip.loadAsync(bytes);
        const entries = Object.values(zip.files).filter(entry => !entry.dir && /^(ppt\/slides\/slide\d+\.xml|word\/document\.xml|Contents\/section\d+\.xml)$/.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).slice(0, 30);
        const pieces: string[] = []; let total = 0;
        for (const entry of entries) {
          const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? Infinity;
          if (size > 1024 * 1024 || total + size > 4 * 1024 * 1024) continue;
          const extracted = await readZipText(entry, Math.min(1024 * 1024, 4 * 1024 * 1024 - total));
          total += extracted.byteLength;
          const xml = extracted.text;
          pieces.push([...xml.matchAll(/<(?:a|w|hp):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|w|hp):t>/g)].map(match => match[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).join("\n"));
        }
        text = pieces.join("\n").slice(0, 60000);
      } catch { /* The original is retained; filename classification remains usable. */ }
    }
    if (html) text = [html.title, html.description, html.text].filter(Boolean).join("\n");
    const draft = materialDraft(file.name, text, purpose);
    if (html?.title) draft.title = html.title;
    if (html?.description) draft.summary = html.description;
    if (html?.author) draft.author = html.author;
    const id = `${purpose}-${digest.slice(0, 24)}`, documentId = `file-${digest.slice(0, 24)}`;
    materials.push({ item: { ...draft, id, createdAt: now, updatedAt: now, sourceFile: { name: file.name, size: file.size, sha256: digest } }, documentId });
    documents.push({ id: documentId, name: file.name, mime, size: file.size, sha256: digest, bytes, recordIds: [], createdAt: now, text: "", analysisStatus: "자료 자동 정리" });
  }
  return { format: "classroom-material-import", version: 1, purpose, materials, documents };
}
