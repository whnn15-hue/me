import { normalizeCareer, cleanText } from '../store.mjs';
import { ALLOWED_EXTENSIONS } from '../backup.mjs';
import { FreeRestRepository } from './repository.mjs';
import { fault, safeName, MAX_FILE_SIZE } from './files.mjs';
import { extname } from 'node:path';

export const MAX_SNAPSHOT_SIZE = 5 * 1024 * 1024;
export function serializeDriveSnapshot(snapshot) {
  if (!Array.isArray(snapshot.careers) || !Array.isArray(snapshot.documents) || snapshot.careers.length > 100000 || snapshot.documents.length > 10000) throw fault('자동 백업 항목 수가 복원 범위를 초과했습니다.', 413);
  const documentIds = new Set(), hashes = new Set();
  const documents = snapshot.documents.map(input => {
    if (!input || !/^[A-Za-z0-9_-]{1,100}$/.test(input.id || '') || documentIds.has(input.id) || !/^[A-Za-z0-9_-]{8,200}$/.test(input.driveFileId || '') || !/^[a-f0-9]{64}$/.test(input.sha256 || '') || hashes.has(input.sha256) || !Number.isSafeInteger(input.size) || input.size < 0 || input.size > MAX_FILE_SIZE) throw fault('공문 파일의 자동 백업 정보가 올바르지 않습니다.');
    if (['name', 'mime', 'createdAt', 'text', 'analysisStatus'].some(field => input[field] != null && typeof input[field] !== 'string')) throw fault('공문 메타데이터의 형식이 올바르지 않습니다.');
    const name = safeName(input.name); if (!ALLOWED_EXTENSIONS.has(extname(name).toLowerCase())) throw fault('지원하지 않는 공문 파일 형식입니다.');
    documentIds.add(input.id); hashes.add(input.sha256);
    const createdAt = cleanText(input.createdAt, 50) || new Date().toISOString();
    if (!Number.isFinite(Date.parse(createdAt))) throw fault('공문 등록 시각이 올바르지 않습니다.');
    const document = { id: input.id, name, size: input.size, mime: cleanText(input.mime, 100) || 'application/octet-stream', createdAt, text: cleanText(input.text, 24000), analysisStatus: cleanText(input.analysisStatus, 50), sha256: input.sha256, driveFileId: input.driveFileId };
    if (Buffer.byteLength(JSON.stringify(document)) > 128 * 1024) throw fault('공문 메타데이터 크기가 저장 한도를 초과했습니다.');
    return document;
  });
  const careerIds = new Set();
  const careers = snapshot.careers.map(input => {
    if (!input || !/^[A-Za-z0-9_-]{1,100}$/.test(input.id || '') || careerIds.has(input.id) || !Array.isArray(input.documentIds) || input.documentIds.length > 1000 || input.documentIds.some(id => !documentIds.has(id))) throw fault('자동 백업의 경력·증빙 연결이 올바르지 않습니다.');
    if (['title', 'organization', 'role', 'startDate', 'endDate', 'description', 'source'].some(field => input[field] != null && typeof input[field] !== 'string') || input.tags != null && (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string'))) throw fault('경력 메타데이터의 형식이 올바르지 않습니다.');
    careerIds.add(input.id); const career = normalizeCareer(input);
    if (career.startDate && career.endDate && career.endDate < career.startDate) throw fault('종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요.');
    return career;
  });
  const manifest = { format: 'career-drive-snapshot', version: 1, createdAt: new Date().toISOString(), careers, documents };
  const buffer = Buffer.from(JSON.stringify(manifest, null, 2));
  if (buffer.length > MAX_SNAPSHOT_SIZE) throw fault('자동 백업의 경력·공문 목록이 5MB를 초과했습니다. 경력 데이터를 나누어 정리해 주세요.', 413);
  return buffer;
}
export function createAutomaticSnapshot({ config, fetcher, repositoryFactory = values => new FreeRestRepository(values) }) {
  return async (uid, { idToken }) => {
    const repo = repositoryFactory({ projectId: config.projectId, uid, idToken, fetcher });
    // Originals already live in the private Drive folder and are immutable.
    // This bounded snapshot preserves their IDs, hashes and career links without
    // downloading a 200MB archive inside Netlify's 30-second scheduled function.
    return serializeDriveSnapshot(await repo.snapshot());
  };
}
