const MAX_CODE_BYTES = 1024 * 1024;

export function backupFileFromCode(code: string): File {
  if (typeof code !== "string" || !code.trim())
    throw new Error("전달받은 백업 코드를 붙여넣어 주세요.");
  if (
    code.length > MAX_CODE_BYTES ||
    new TextEncoder().encode(code).byteLength > MAX_CODE_BYTES
  )
    throw new Error("백업 코드는 최대 1 MiB까지 입력할 수 있습니다.");

  const compact = code.replace(/\s+/g, "");
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
  if (
    bytes.length < 30 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  )
    throw new Error("백업 코드에 올바른 ZIP 백업 파일이 들어 있지 않습니다.");

  return new File([bytes], "Introduce_Me_코드백업.zip", { type: "application/zip" });
}
