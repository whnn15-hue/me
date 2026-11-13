import { driveQuota } from "../../shared/resources.mjs";
import { decodeHtmlEntities, validOneDriveItemId } from "../../shared/storage-id.mjs";
import type { DriveFile } from "./drive";

// Browser-side Microsoft OneDrive (personal) operations. The server returns a
// short-lived Graph token limited to the app folder; files are sent directly
// between the browser and OneDrive, as with Google Drive.
export type OneDriveAccess = {
  accessToken: string; folderId: string; provider: "onedrive";
  /** Memory-only recovery for a Graph token rejected before its recorded expiry. */
  refresh?: () => Promise<OneDriveAccess>;
};

const GRAPH = "https://graph.microsoft.com/v1.0";
export const SIMPLE_UPLOAD_BYTES = 5 * 1024 * 1024;
// Upload-session fragments must be multiples of 320 KiB.
const CHUNK = 320 * 1024 * 16;
const kinds = ["document", "template", "export", "output", "backup"];

type GraphItem = {
  id: string; name: string; size?: number; deleted?: unknown;
  file?: { mimeType?: string }; parentReference?: { id?: string }; description?: string;
  "@microsoft.graph.downloadUrl"?: string;
};

export function oneDriveName(value: string) {
  return value.replace(/[\r\n\0"*:<>?/\\|]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 240) || "file";
}

function archiveProperties(description?: string): Record<string, string> {
  try {
    const parsed = JSON.parse(decodeHtmlEntities(description || ""));
    if (parsed?.v !== 1 || typeof parsed.archiveUid !== "string" || !kinds.includes(parsed.kind)) return {};
    return { archiveUid: parsed.archiveUid, kind: parsed.kind, ...(typeof parsed.sha256 === "string" ? { sha256: parsed.sha256 } : {}) };
  } catch { return {}; }
}

export function driveShaped(item: GraphItem): DriveFile {
  return {
    id: item.id, name: item.name, mimeType: item.file?.mimeType || "application/octet-stream",
    size: String(item.size ?? ""), parents: item.parentReference?.id ? [item.parentReference.id] : [],
    appProperties: archiveProperties(item.description),
  };
}

async function graphResponse(response: Response) {
  if (response.ok) return response;
  if (response.status === 401) throw new Error("OneDrive 인증을 확인하지 못했습니다. 백업 및 설정에서 다시 연결해 주세요.");
  if (response.status === 403) throw new Error("OneDrive 권한을 확인해 주세요.");
  if (response.status === 404) throw new Error("OneDrive에서 파일을 찾지 못했습니다. 구글 드라이브에 보관된 원본이면 OneDrive로 옮긴 뒤 다시 시도해 주세요.");
  if (response.status === 507) throw new Error("OneDrive 저장 공간이 부족합니다.");
  throw new Error(`OneDrive 요청을 처리하지 못했습니다 (${response.status}).`);
}

function checkedId(id: string) {
  if (!validOneDriveItemId(id)) throw new Error("OneDrive 파일 정보를 확인할 수 없습니다. 구글 드라이브에 보관된 원본이면 OneDrive로 옮긴 뒤 다시 시도해 주세요.");
  return id;
}

const auth = (credentials: OneDriveAccess) => ({ Authorization: `Bearer ${credentials.accessToken}` });

/** Retry only the rejected Graph operation, never a whole upload. Pre-authorized
 * upload and download URLs must never use this helper or receive a Graph token. */
async function graphFetch(url: string, credentials: OneDriveAccess, options: RequestInit = {}) {
  if (!url.startsWith(`${GRAPH}/`)) throw new Error("OneDrive 요청 주소를 확인하지 못했습니다.");
  const send = () => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${credentials.accessToken}`);
    return fetch(url, { ...options, headers, credentials: "omit" });
  };
  let response = await send();
  if (response.status === 401 && credentials.refresh) {
    const refreshed = await credentials.refresh();
    if (refreshed?.provider !== "onedrive" || typeof refreshed.accessToken !== "string" || !refreshed.accessToken
      || refreshed.folderId !== credentials.folderId)
      throw new Error("파일 보관 계정이 변경되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.");
    credentials.accessToken = refreshed.accessToken;
    response = await send();
  }
  return response;
}

async function transferResponse(response: Response, stage: "upload" | "download") {
  if (response.ok) return response;
  // These URLs already contain temporary authorization. Their 401 response is
  // not evidence that the Microsoft account refresh token has expired.
  if ([401, 403, 404, 410].includes(response.status)) throw new Error(stage === "upload"
    ? `OneDrive 업로드 연결을 사용할 수 없습니다. 파일을 다시 올려 주세요 (HTTP ${response.status}).`
    : `OneDrive 다운로드 주소를 사용할 수 없습니다. 원본을 다시 열어 주세요 (HTTP ${response.status}).`);
  if (response.status === 507) throw new Error("OneDrive 저장 공간이 부족합니다.");
  throw new Error(`OneDrive ${stage === "upload" ? "파일 업로드" : "원본 다운로드"}에 실패했습니다 (HTTP ${response.status}). 잠시 후 다시 시도해 주세요.`);
}

export async function readOneDriveStorage(credentials: OneDriveAccess) {
  const response = await graphResponse(await graphFetch(`${GRAPH}/me/drive?$select=quota`, credentials, {
    signal: AbortSignal.timeout(15000),
  }));
  const quota = (await response.json()).quota || {};
  const text = (value: unknown) => Number.isSafeInteger(value) ? String(value) : undefined;
  return driveQuota({ usage: text(quota.used), limit: text(quota.total) });
}

export async function ownedOneDriveItem(fileId: string, credentials: OneDriveAccess, archiveUid: string) {
  const id = checkedId(fileId);
  const response = await graphResponse(await graphFetch(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}`, credentials));
  const item: GraphItem = await response.json();
  const metadata = driveShaped(item);
  if (item.deleted || !metadata.parents?.includes(credentials.folderId) || metadata.appProperties?.archiveUid !== archiveUid)
    throw new Error("내 경력 보관함에 연결된 파일만 열 수 있습니다.");
  return { metadata, downloadUrl: item["@microsoft.graph.downloadUrl"] };
}

export async function uploadOneDriveFile(
  file: File, mimeType: string, kind: string, fileHash: string, archiveUid: string, credentials: OneDriveAccess,
): Promise<DriveFile> {
  if (!file.size) throw new Error("빈 파일은 보관할 수 없습니다.");
  const name = oneDriveName(file.name);
  const description = JSON.stringify({ v: 1, archiveUid, kind, sha256: fileHash });
  let item: GraphItem | undefined;
  if (file.size <= SIMPLE_UPLOAD_BYTES) {
    // A content PUT replaces same-name files by default. Use a unique storage
    // name as well as conflict=fail; the document record keeps the original title.
    const extension = /\.[^.]{1,20}$/.exec(name)?.[0] || "";
    const suffix = `__${crypto.randomUUID()}`;
    const storageName = `${name.slice(0, extension ? -extension.length : undefined).slice(0, 240 - suffix.length - extension.length)}${suffix}${extension}`;
    const uploaded = await graphResponse(await graphFetch(
      `${GRAPH}/me/drive/items/${encodeURIComponent(credentials.folderId)}:/${encodeURIComponent(storageName)}:/content?%40microsoft.graph.conflictBehavior=fail`, credentials, {
        method: "PUT", headers: { "Content-Type": mimeType }, body: file, signal: AbortSignal.timeout(120000),
      }));
    item = await uploaded.json();
  } else {
    const session = await graphResponse(await graphFetch(
      `${GRAPH}/me/drive/items/${encodeURIComponent(credentials.folderId)}:/${encodeURIComponent(name)}:/createUploadSession`, credentials, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename", name } }),
      }));
    const { uploadUrl } = await session.json();
    if (typeof uploadUrl !== "string" || !uploadUrl.startsWith("https://")) throw new Error("OneDrive 업로드 주소를 확인하지 못했습니다.");
    try {
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        const end = Math.min(file.size, offset + CHUNK);
        // The upload URL is pre-authorized; sending the Graph token there is not allowed.
        const response = await fetch(uploadUrl, {
          method: "PUT", credentials: "omit",
          headers: { "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`, "Content-Type": mimeType },
          body: file.slice(offset, end),
        });
        if (response.status === 202) continue;
        item = await (await transferResponse(response, "upload")).json();
        break;
      }
    } catch (error) {
      await fetch(uploadUrl, { method: "DELETE", credentials: "omit" }).catch(() => undefined);
      throw error;
    }
  }
  if (!item || !validOneDriveItemId(item.id)) throw new Error("OneDrive에 파일을 보관하지 못했습니다.");
  // Only the rejected metadata operation may be retried. Never resend bytes
  // after the original has been accepted, including on temporary Graph errors.
  const itemURL = `${GRAPH}/me/drive/items/${encodeURIComponent(item.id)}`;
  try {
    await graphResponse(await graphFetch(itemURL, credentials, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }) }));
  } catch (error) {
    // Clean up only this new, unregistered file, with the latest token and no
    // additional refresh loop. Existing files are never selected for cleanup.
    await fetch(itemURL, { method: "DELETE", credentials: "omit", headers: auth(credentials) }).catch(() => undefined);
    throw error instanceof Error ? error : new Error("OneDrive 파일 정보를 저장하지 못했습니다. 다시 시도해 주세요.");
  }
  return { ...driveShaped(item), appProperties: { archiveUid, kind, sha256: fileHash } };
}

export async function downloadOneDriveContent(downloadUrl: string | undefined) {
  if (!downloadUrl?.startsWith("https://")) throw new Error("OneDrive 원본 주소를 확인하지 못했습니다.");
  // A pre-authenticated, short-lived URL; no token is attached.
  return (await transferResponse(await fetch(downloadUrl, { credentials: "omit" }), "download")).blob();
}

export async function trashOneDriveItem(fileId: string, credentials: OneDriveAccess) {
  // DELETE moves the item to the OneDrive recycle bin, like Drive's trash.
  await graphResponse(await graphFetch(`${GRAPH}/me/drive/items/${encodeURIComponent(checkedId(fileId))}`, credentials, {
    method: "DELETE",
  }));
}
