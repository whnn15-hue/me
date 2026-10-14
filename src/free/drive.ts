import { api } from "../api";
import { cloudUserError, readyCloudUser } from "../cloud";

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

type DriveAccess = { accessToken: string; folderId: string };

const fileTypes: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  cell: "application/vnd.hancom.cell",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function validateDriveUploadFile(file: File, kind: "document" | "template" = "document") {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("공문과 양식은 파일당 최대 25 MB까지 올릴 수 있습니다.");
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  if (!fileTypes[extension] || (kind === "template" && extension !== "hwpx"))
    throw new Error(kind === "template"
      ? "HWPX 양식을 올려 주세요. HWP는 한글에서 HWPX로 저장해 주세요."
      : "PDF, HWP/HWPX, Word, Excel, 한셀, 텍스트 또는 이미지 파일을 올려 주세요.");
  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const starts = (values: number[], offset = 0) => values.every((value, index) => header[offset + index] === value);
  const text = new TextDecoder().decode(header);
  const valid = extension === "txt" ||
    extension === "pdf" && text.includes("%PDF-") ||
    ["hwpx", "docx", "xlsx", "cell", "pptx"].includes(extension) && starts([0x50, 0x4b]) ||
    ["hwp", "ppt"].includes(extension) && starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) ||
    extension === "png" && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    ["jpg", "jpeg"].includes(extension) && starts([0xff, 0xd8]) ||
    extension === "webp" && starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
  if (!valid) throw new Error("파일 확장자와 실제 내용이 다릅니다. 원본 파일 형식을 확인해 주세요.");
  return fileTypes[extension];
}

async function access(): Promise<DriveAccess> {
  const result = await api<DriveAccess>("/auth/drive/access", { method: "POST" });
  if (!result.accessToken || !result.folderId)
    throw new Error("백업 및 공문 보관에 사용할 구글 드라이브를 먼저 연결해 주세요.");
  return result;
}

function checkedId(id: string) {
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(id))
    throw new Error("구글 드라이브 파일 정보를 확인할 수 없습니다.");
  return id;
}

async function driveResponse(response: Response) {
  if (response.ok) return response;
  if (response.status === 401)
    throw new Error("구글 드라이브 인증이 만료되었습니다. 다시 연결해 주세요.");
  if (response.status === 403)
    throw new Error("구글 드라이브 권한 또는 사용 가능한 저장 공간을 확인해 주세요.");
  throw new Error(`구글 드라이브 요청을 처리하지 못했습니다 (${response.status}).`);
}

async function ownerUid() {
  const user = await readyCloudUser();
  if (!user) throw new Error("구글 계정으로 로그인해 주세요.");
  const error = cloudUserError(user);
  if (error) throw new Error(error);
  return user.uid;
}

async function ownedFile(fileId: string, credentials: DriveAccess) {
  const id = checkedId(fileId);
  const response = await driveResponse(await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,size,mimeType,parents,appProperties`,
    { headers: { Authorization: `Bearer ${credentials.accessToken}` }, credentials: "omit" },
  ));
  const metadata: DriveFile = await response.json();
  if (
    !metadata.parents?.includes(credentials.folderId) ||
    metadata.appProperties?.archiveUid !== await ownerUid()
  )
    throw new Error("내 경력 보관함에 연결된 파일만 열 수 있습니다.");
  return metadata;
}

export async function sha256(bytes: ArrayBuffer | Uint8Array) {
  const source = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const hash = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadDriveFile(
  file: File,
  kind: "document" | "template" = "document",
  digest?: string,
): Promise<DriveFile & { sha256: string }> {
  const mimeType = await validateDriveUploadFile(file, kind);
  const credentials = await access();
  const archiveUid = await ownerUid();
  const fileHash = digest || await sha256(await file.arrayBuffer());
  if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new Error("파일 무결성 정보를 확인해 주세요.");
  const boundary = `career_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = {
    name: file.name,
    parents: [credentials.folderId],
    appProperties: { archiveUid, kind, sha256: fileHash },
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`,
  ]);
  const response = await driveResponse(await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      credentials: "omit",
    },
  ));
  const uploaded: DriveFile = await response.json();
  if (!uploaded.id) throw new Error("구글 드라이브에 파일을 보관하지 못했습니다.");
  return { ...uploaded, sha256: fileHash };
}

export async function downloadDriveFile(
  fileId: string,
  expected?: { size?: number; sha256?: string; kind?: "document" },
) {
  const credentials = await access();
  const metadata = await ownedFile(fileId, credentials);
  const size = Number(metadata.size || 0);
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    expected?.size !== undefined && size !== expected.size ||
    expected?.kind && metadata.appProperties?.kind !== expected.kind
  )
    throw new Error("공문 원본의 크기 또는 보관 정보를 확인할 수 없습니다.");
  if (size > 200 * 1024 * 1024)
    throw new Error("한 번에 내려받을 수 있는 파일 크기는 최대 200 MB입니다.");
  const response = await driveResponse(await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${credentials.accessToken}` }, credentials: "omit" },
  ));
  const blob = await response.blob();
  if (blob.size !== size) throw new Error("공문 원본을 완전히 내려받지 못했습니다.");
  if (expected?.sha256 && await sha256(await blob.arrayBuffer()) !== expected.sha256)
    throw new Error("공문 원본이 백업 이후 변경되었습니다. 파일 무결성을 확인해 주세요.");
  return { blob, name: metadata.name };
}

export async function trashDriveFile(fileId: string) {
  const credentials = await access();
  await ownedFile(fileId, credentials);
  await driveResponse(await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
      credentials: "omit",
    },
  ));
}
