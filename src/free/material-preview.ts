import { decodeHtml, isHtmlBytes } from "../../shared/html.mjs";
import type { MaterialItem } from "../workspace/types";
import { downloadDriveFile } from "./drive";

export async function loadMaterialHtml(item: MaterialItem): Promise<string> {
  const source = item.sourceFile;
  let url: URL;
  try { url = new URL(item.fileUrl); }
  catch { throw new Error("HTML 원본의 드라이브 링크를 먼저 연결해 주세요."); }
  const id = /^\/file\/d\/([A-Za-z0-9_-]{8,200})\/view\/?$/.exec(url.pathname)?.[1];
  if (!source || item.format !== "HTML" || !/\.html?$/i.test(source.name) || !id || url.origin !== "https://drive.google.com" || url.username || url.password)
    throw new Error("앱에 직접 올린 HTML 자료만 미리 볼 수 있습니다.");
  if (source.size > 2 * 1024 * 1024) throw new Error("미리보기는 2 MB까지 지원합니다. 드라이브에서 원본을 열어 주세요.");
  const { blob } = await downloadDriveFile(id, { size: source.size, sha256: source.sha256, kind: "document" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isHtmlBytes(bytes)) throw new Error("HTML 원본의 형식을 확인해 주세요.");
  return decodeHtml(bytes);
}
