const MAX_CODE_BYTES = 1024 * 1024;
const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_EVIDENCE_IMPORT_BYTES = 16 * 1024 * 1024;

function compactCode(code: string) {
  if (typeof code !== "string" || !code.trim())
    throw new Error("전달받은 백업 코드를 붙여넣어 주세요.");
  if (
    code.length > MAX_CODE_BYTES ||
    new TextEncoder().encode(code).byteLength > MAX_CODE_BYTES
  )
    throw new Error("백업 코드는 최대 1 MiB까지 입력할 수 있습니다.");

  return code.replace(/\s+/g, "");
}

function zipFile(bytes: Uint8Array): File {
  if (
    bytes.length < 30 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  )
    throw new Error("백업 코드에 올바른 ZIP 백업 파일이 들어 있지 않습니다.");

  return new File([new Uint8Array(bytes)], "Introduce_Me_코드백업.zip", { type: "application/zip" });
}

export function backupFileFromCode(code: string): File {
  const compact = compactCode(code);
  if (!compact.startsWith("IMBK1:"))
    throw new Error("IMBK1:로 시작하는 백업 코드 전체를 붙여넣어 주세요.");
  const encoded = compact.slice(6);
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw new Error("백업 코드가 손상되었거나 일부가 빠졌습니다. 전체 코드를 다시 붙여넣어 주세요.");

  let decoded: string;
  try {
    decoded = atob(encoded);
    if (btoa(decoded) !== encoded) throw new Error();
  } catch {
    throw new Error("백업 코드가 손상되었습니다. 전달받은 전체 코드를 다시 붙여넣어 주세요.");
  }
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  return zipFile(bytes);
}

async function importBytes(response: Response, limit: number): Promise<Uint8Array> {
  const sizeError = `가져오기 파일은 최대 ${limit / 1024 / 1024} MiB까지 불러올 수 있습니다.`;
  const length = response.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    await response.body?.cancel().catch(() => {});
    throw new Error("복원 파일의 크기 정보를 확인할 수 없습니다.");
  }
  if (length !== null && Number(length) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error(sizeError);
  }
  if (!response.body) throw new Error("복원 파일의 내용이 없습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new Error("복원 파일을 완전히 불러오지 못했습니다. 다시 시도해 주세요.");
      }
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new Error(sizeError);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function backupFileFromImportCode(code: string): Promise<File> {
  const compact = compactCode(code);
  if (compact.startsWith("IMBK1:")) return backupFileFromCode(code);
  return encryptedImportFile(compact, "IMBK2", MAX_IMPORT_BYTES);
}

export async function evidenceFileFromImportCode(code: string): Promise<File> {
  return encryptedImportFile(compactCode(code), "IMEV1", MAX_EVIDENCE_IMPORT_BYTES);
}

async function encryptedImportFile(compact: string, prefix: "IMBK2" | "IMEV1", limit: number): Promise<File> {
  const matched = new RegExp(`^${prefix}:([0-9a-f]{16})\\.([A-Za-z0-9_-]{43})$`).exec(compact);
  if (!matched)
    throw new Error(prefix === "IMEV1" ? "IMEV1:로 시작하는 증빙 가져오기 코드를 붙여넣어 주세요." : "IMBK1: 또는 IMBK2:로 시작하는 백업 코드 전체를 붙여넣어 주세요.");
  let keyBytes: Uint8Array;
  try {
    const decoded = atob(matched[2].replace(/-/g, "+").replace(/_/g, "/") + "=");
    const canonical = btoa(decoded).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (decoded.length !== 32 || canonical !== matched[2]) throw new Error();
    keyBytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  } catch {
    throw new Error("백업 코드가 손상되었습니다. 전달받은 전체 코드를 다시 붙여넣어 주세요.");
  }

  let response: Response;
  try {
    response = await fetch(`/imports/${matched[1]}.bin`, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new Error("복원 파일을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.");
  }
  if (!response.ok || response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`복원 파일을 불러오지 못했습니다 (HTTP ${response.status}). 새로고침 후 다시 시도해 주세요.`);
  }
  const contentType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (response.redirected || contentType !== "application/octet-stream") {
    await response.body?.cancel().catch(() => {});
    throw new Error("올바른 복원 파일을 받지 못했습니다. 새로고침 후 다시 시도해 주세요.");
  }
  const bytes = await importBytes(response, limit);
  const magic = new TextEncoder().encode(`${prefix}:`);
  if (bytes.byteLength < 34 || !magic.every((value, index) => bytes[index] === value))
    throw new Error("복원 파일이 손상되었습니다. 전달받은 코드를 확인해 주세요.");

  let plaintext: ArrayBuffer;
  try {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), "AES-GCM", false, ["decrypt"]);
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(bytes.subarray(6, 18)), tagLength: 128 },
      key,
      new Uint8Array(bytes.subarray(18)),
    );
  } catch {
    throw new Error("백업 코드를 확인하지 못했습니다. 전달받은 전체 코드를 다시 붙여넣어 주세요.");
  }
  return zipFile(new Uint8Array(plaintext));
}
