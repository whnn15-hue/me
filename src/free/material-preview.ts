import { decodeHtml, isHtmlBytes } from "../../shared/html.mjs";
import type { MaterialItem } from "../workspace/types";
import { downloadDriveFile } from "./drive";
import {audioName, extraFileTypes, validExtraFile} from "../../shared/resources.mjs";

export async function loadMaterialAudio(item:MaterialItem):Promise<Blob> {
  const source=item.sourceFile;
  let url:URL;try{url=new URL(item.fileUrl);}catch{throw new Error("앱에 직접 올린 오디오만 미리 들을 수 있습니다.");}
  const id=/^\/file\/d\/([A-Za-z0-9_-]{8,200})\/view\/?$/.exec(url.pathname)?.[1];
  if(!source || !audioName(source.name) || !id || url.origin!=="https://drive.google.com" || url.username || url.password || source.size>25*1024*1024)
    throw new Error("앱에 직접 올린 25 MB 이하의 오디오만 미리 들을 수 있습니다.");
  const {blob}=await downloadDriveFile(id,{size:source.size,sha256:source.sha256,kind:"document"});
  const extension=source.name.split('.').at(-1)!.toLowerCase();
  if(!validExtraFile(extension,new Uint8Array(await blob.slice(0,65536).arrayBuffer())))throw new Error("오디오 원본의 형식을 확인해 주세요.");
  return new Blob([blob],{type:extraFileTypes[extension]});
}

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
