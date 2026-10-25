import {
  cloudApiUrl,
  cloudMode,
  previewMode,
  freeMode,
  cloudToken,
  cloudConfigurationError,
  cloudUserError,
  readyCloudUser,
  signedOutCloudStatus,
} from "./cloud";
import { type Status, type DocumentRecord } from "./types";

let approvedUid: string | null = null;

async function responseJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(
      `서버가 올바른 데이터로 응답하지 않았습니다 (HTTP ${response.status}). 배포 상태를 확인해 주세요.`,
    );
  }
}

async function dispatchFree(path: string, options: RequestInit) {
  const user = await readyCloudUser();
  if (!user || user.uid !== approvedUid)
    throw new Error("본인 계정의 서버 연결을 먼저 확인해 주세요.");
  const { freeApi } = await import("./free/api");
  return freeApi(path, options);
}

async function request(path: string, options: RequestInit) {
  if (freeMode && options.body instanceof FormData) {
    const { prepareTemplateRequest } = await import("./free/api");
    options = await prepareTemplateRequest(path, options);
  }
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (cloudMode) headers.set("Authorization", `Bearer ${await cloudToken()}`);
  const response = await fetch(cloudApiUrl(path), {
    ...options,
    headers,
    credentials: cloudMode && !freeMode ? "omit" : "same-origin",
  });
  if (!response.ok) {
    const data = response.headers.get("Content-Type")?.toLowerCase().includes("json")
      ? await response.json().catch(() => null)
      : null;
    const message = data?.error || data?.message;
    throw new Error(
      typeof message === "string" && message
        ? message
        : `서버 요청을 처리하지 못했습니다 (HTTP ${response.status}). 배포 상태와 연결 설정을 확인해 주세요.`,
    );
  }
  return response;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (previewMode) return (await import("./preview/api")).previewApi<T>(path, options);
  if (cloudMode && path === "/status") {
    approvedUid = null;
    if (cloudConfigurationError) return signedOutCloudStatus() as T;
    const user = await readyCloudUser();
    if (!user) return signedOutCloudStatus() as T;
    const userError = cloudUserError(user);
    if (userError) return signedOutCloudStatus(userError) as T;
    const status = await responseJson<Status>(await request(path, options));
    if (
      !status ||
      status.mode !== "firebase" ||
      !status.ownerConfigured ||
      status.user?.email?.toLowerCase() !== user.email?.toLowerCase()
    )
      throw new Error(
        "Firebase API 주소 또는 본인 계정의 서버 접근 설정을 확인해 주세요.",
      );
    approvedUid = user.uid;
    return {
      ...status,
      firebaseConfigured: true,
      deploymentMode: freeMode ? "free" : "paid",
    } as T;
  }
  if (freeMode) {
    const result = await dispatchFree(path, options);
    if (result.handled) return result.value as T;
  }
  return responseJson<T>(await request(path, options));
}
export async function download(
  path: string,
  filename: string,
  options: RequestInit = {},
) {
  if (previewMode) {
    const match = /^\/documents\/([^/]+)\/file$/.exec(path);
    if (!match) throw new Error("미리보기에서는 선택 사진 ZIP과 JSON 백업을 이용해 주세요.");
    saveBlob(await (await import("./preview/api")).previewOriginal(match[1]), filename); return;
  }
  if (freeMode) {
    const result = await dispatchFree(path, options);
    if (result.handled) {
      const file = result.value as {
        blob?: Blob;
        driveFileId: string;
        fileName?: string;
        size?: number;
        sha256?: string;
        kind?: "document";
      };
      if (file.blob) {
        saveBlob(file.blob, file.fileName || filename);
        return;
      }
      const { downloadDriveFile } = await import("./free/drive");
      const source = await downloadDriveFile(file.driveFileId, {
        size: file.size,
        sha256: file.sha256,
        kind: file.kind,
      });
      saveBlob(source.blob, file.fileName || source.name || filename);
      return;
    }
  }
  const response = await request(path, options);
  if (
    cloudMode &&
    response.headers.get("Content-Type")?.includes("application/json")
  ) {
    const result: { downloadUrl?: string; driveFileId?: string; fileName?: string } =
      await responseJson(response);
    if (freeMode && result.driveFileId) {
      const { downloadDriveFile } = await import("./free/drive");
      const source = await downloadDriveFile(result.driveFileId);
      saveBlob(source.blob, result.fileName || source.name || filename);
      return;
    }
    if (!result.downloadUrl || new URL(result.downloadUrl).protocol !== "https:")
      throw new Error("파일 다운로드 주소를 확인하지 못했습니다.");
    const anchor = document.createElement("a");
    anchor.href = result.downloadUrl;
    anchor.download = result.fileName || filename;
    anchor.rel = "noreferrer";
    anchor.click();
    return;
  }
  saveBlob(await response.blob(), filename);
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Use the same authenticated original-file path as archive downloads. */
export async function loadDocumentBlob(document: DocumentRecord): Promise<Blob> {
  if (previewMode) return (await import("./preview/api")).previewOriginal(document.id);
  const path = `/documents/${document.id}/file`;
  if (freeMode) {
    const result = await dispatchFree(path, {});
    const file = result.value as { driveFileId: string; size: number; sha256: string; kind: "document" };
    const { downloadDriveFile } = await import("./free/drive");
    return (await downloadDriveFile(file.driveFileId, file)).blob;
  }
  const response = await request(path, {});
  if (response.headers.get("Content-Type")?.includes("application/json")) {
    const data = await responseJson<{ downloadUrl?: string }>(response);
    if (!data.downloadUrl || new URL(data.downloadUrl).protocol !== "https:") throw new Error("원본 주소를 확인하지 못했습니다.");
    const original = await fetch(data.downloadUrl, { credentials: "omit" });
    if (!original.ok) throw new Error("원본을 불러오지 못했습니다.");
    return original.blob();
  }
  return response.blob();
}
