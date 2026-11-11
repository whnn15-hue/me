import { driveQuota } from "../../shared/resources.mjs";
import { validOneDriveItemId } from "../../shared/storage-id.mjs";
import type { DriveFile } from "./drive";

// Browser-side Microsoft OneDrive (personal) operations. The server returns a
// short-lived Graph token limited to the app folder; files are sent directly
// between the browser and OneDrive, as with Google Drive.
export type OneDriveAccess = { accessToken: string; folderId: string; provider: "onedrive" };

const GRAPH = "https://graph.microsoft.com/v1.0";
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
    const parsed = JSON.parse(description || "");
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
  if (response.status === 401) throw new Error("OneDrive 인증이 만료되었습니다. 다시 연결해 주세요.");
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

export async function readOneDriveStorage(credentials: OneDriveAccess) {
  const response = await graphResponse(await fetch(`${GRAPH}/me/drive?$select=quota`, {
    headers: auth(credentials), credentials: "omit", signal: AbortSignal.timeout(15000),
  }));
  const quota = (await response.json()).quota || {};
  const text = (value: unknown) => Number.isSafeInteger(value) ? String(value) : undefined;
  return driveQuota({ usage: text(quota.used), limit: text(quota.total) });
}

export async function ownedOneDriveItem(fileId: string, credentials: OneDriveAccess, archiveUid: string) {
  const id = checkedId(fileId);
  const response = await graphResponse(await fetch(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}`, {
    headers: auth(credentials), credentials: "omit",
  }));
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
  const session = await graphResponse(await fetch(
    `${GRAPH}/me/drive/items/${encodeURIComponent(credentials.folderId)}:/${encodeURIComponent(name)}:/createUploadSession`, {
      method: "POST", headers: { ...auth(credentials), "Content-Type": "application/json" }, credentials: "omit",
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename", name, description } }),
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
      const item: GraphItem = await (await graphResponse(response)).json();
      if (!validOneDriveItemId(item.id)) break;
      return { ...driveShaped(item), appProperties: { archiveUid, kind, sha256: fileHash } };
    }
  } catch (error) {
    await fetch(uploadUrl, { method: "DELETE", credentials: "omit" }).catch(() => undefined);
    throw error;
  }
  throw new Error("OneDrive에 파일을 보관하지 못했습니다.");
}

export async function downloadOneDriveContent(downloadUrl: string | undefined) {
  if (!downloadUrl?.startsWith("https://")) throw new Error("OneDrive 원본 주소를 확인하지 못했습니다.");
  // A pre-authenticated, short-lived URL; no token is attached.
  return (await graphResponse(await fetch(downloadUrl, { credentials: "omit" }))).blob();
}

export async function trashOneDriveItem(fileId: string, credentials: OneDriveAccess) {
  // DELETE moves the item to the OneDrive recycle bin, like Drive's trash.
  await graphResponse(await fetch(`${GRAPH}/me/drive/items/${encodeURIComponent(checkedId(fileId))}`, {
    method: "DELETE", headers: auth(credentials), credentials: "omit",
  }));
}
