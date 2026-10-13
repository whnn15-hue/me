import { writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exportBackup, ALLOWED_EXTENSIONS } from '../backup.mjs';
import { cloudExtract, inTemp, sha256 } from '../cloud/files.mjs';
import { FreeRestRepository } from './repository.mjs';

export { cloudExtract as extractFile, sha256 };
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_BACKUP_SIZE = 200 * 1024 * 1024;
export const fault = (message, status = 400) => Object.assign(new Error(message), { status });
export function safeName(name) { return String(name || '').replace(/[\/\\\u0000-\u001f]/g, '_').slice(0, 300); }
export async function readBounded(response, maxBytes) {
  if (!response.ok) throw fault('구글 드라이브에서 파일을 읽지 못했습니다.', 502);
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw fault('파일 용량 제한을 초과했습니다.', 413);
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  try {
    for (;;) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > maxBytes) throw fault('파일 용량 제한을 초과했습니다.', 413); chunks.push(Buffer.from(result.value)); }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}
export async function readDriveFile(drive, fetcher, uid, id, options = {}) {
  const { metadata, accessToken } = await drive.requireFile(uid, id, { kind: options.kind, driveAccessToken: options.driveAccessToken });
  if (!Number.isFinite(Number(metadata.size)) || Number(metadata.size) > MAX_FILE_SIZE) throw fault('공문 및 HWPX 양식은 25MB까지 지원합니다.', 413);
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(25000) });
  const buffer = await readBounded(response, MAX_FILE_SIZE);
  const objectHash = metadata.appProperties?.sha256;
  if (['document', 'template'].includes(options.kind) && !/^[a-f0-9]{64}$/.test(objectHash || '')) throw fault('원본 파일의 무결성 정보가 없습니다. 다시 업로드해 주세요.');
  const actualHash = sha256(buffer);
  if (buffer.length !== Number(metadata.size) || options.size !== undefined && buffer.length !== options.size || options.sha256 && actualHash !== options.sha256 || objectHash && actualHash !== objectHash) throw fault('원본 파일의 크기·무결성 검증에 실패했습니다.');
  return { buffer, metadata, name: safeName(metadata.name), mime: metadata.mimeType };
}
export function createDriveBackup({ config, fetcher, getDrive, repositoryFactory = values => new FreeRestRepository(values) }) {
  return async (uid, { idToken, selectedIds, driveAccessToken } = {}) => {
    const repo = repositoryFactory({ projectId: config.projectId, uid, idToken, fetcher }); const snapshot = await repo.snapshot();
    if (selectedIds && (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id => !snapshot.careers.some(career => career.id === id)))) throw fault('증빙을 모을 경력을 선택해 주세요.');
    const selectedDocs = selectedIds ? new Set(snapshot.careers.filter(career => selectedIds.includes(career.id)).flatMap(career => career.documentIds)) : null;
    const documents = snapshot.documents.filter(document => !selectedDocs || selectedDocs.has(document.id));
    let total = 0;
    for (const document of documents) {
      total += document.size;
      if (!Number.isSafeInteger(document.size) || document.size < 0 || document.size > MAX_FILE_SIZE || !/^[a-f0-9]{64}$/.test(document.sha256 || '')) throw fault('공문 파일 정보가 올바르지 않습니다.');
      if (total > MAX_BACKUP_SIZE) throw fault('백업 원본 합계가 200MB를 초과했습니다. 경력별 증빙 묶음을 이용해 주세요.', 413);
    }
    return inTemp(async directory => {
      const materialized = [];
      for (const document of documents) {
        const file = await readDriveFile(getDrive(), fetcher, uid, document.driveFileId, { kind: 'document', size: document.size, sha256: document.sha256, driveAccessToken });
        const extension = extname(file.name).toLowerCase(); if (!ALLOWED_EXTENSIONS.has(extension)) throw fault('지원하지 않는 공문 원본 형식입니다.');
        const storageName = `${randomUUID()}${extension}`;
        await writeFile(join(directory, 'originals', storageName), file.buffer, { flag: 'wx', mode: 0o600 });
        materialized.push({ ...document, storageName });
      }
      const store = { dataDir: directory, careers: () => snapshot.careers, documents: () => materialized };
      return exportBackup(store, selectedIds);
    });
  };
}
