import {
  cloudApiUrl,
  cloudMode,
  freeMode,
  cloudToken,
  cloudConfigurationError,
  cloudUserError,
  readyCloudUser,
  signedOutCloudStatus,
} from "./cloud";
import { type Status } from "./types";

let approvedUid: string | null = null;

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
    credentials: cloudMode ? "omit" : "same-origin",
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ error: "요청을 처리하지 못했습니다." }));
    throw new Error(
      data.error || data.message || `요청 실패 (${response.status})`,
    );
  }
  return response;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (cloudMode && path === "/status") {
    approvedUid = null;
    if (cloudConfigurationError) return signedOutCloudStatus() as T;
    const user = await readyCloudUser();
    if (!user) return signedOutCloudStatus() as T;
    const userError = cloudUserError(user);
    if (userError) return signedOutCloudStatus(userError) as T;
    const status: Status = await (await request(path, options)).json();
    if (
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
  return (await request(path, options)).json() as Promise<T>;
}
export async function download(
  path: string,
  filename: string,
  options: RequestInit = {},
) {
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
      await response.json();
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
