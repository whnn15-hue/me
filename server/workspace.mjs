import { randomUUID } from 'node:crypto';
import { normalizeCareer, publicDocument } from './store.mjs';
import { emptyWorkspace, normalizeWorkspace, mutateWorkspace, mergeWorkspaceData } from '../shared/workspace.mjs';

const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_CAREERS = 100000;
const MAX_DOCUMENTS = 10000;
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const object = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const equivalent = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
function revision(value, expected) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw bad('가져오기 기준 버전을 확인해 주세요.');
  if (value.revision !== expected) throw bad('다른 화면에서 기록이 변경되었습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.', 409);
  if (value.revision >= Number.MAX_SAFE_INTEGER) throw bad('작업 기록 버전 한도에 도달했습니다.', 409);
}
function bounded(value) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ARCHIVE_BYTES) throw bad('전체 JSON 목록은 5 MB 이하로 보관할 수 있습니다.', 413);
  return value;
}
function publicMetadata(document, careers) {
  const { storageName: _storageName, filePath: _filePath, ...visible } = publicDocument(document, careers);
  return { ...visible, sha256: document.sha256 };
}
export function readWorkspace(store) {
  // An older app can delete careers while leaving this extension untouched.
  // Reopening the new app keeps every item and drops only obsolete career edges.
  return normalizeWorkspace(store.workspace(), { careerIds: store.careers().map(career => career.id), pruneMissingCareerLinks: true });
}
export function saveWorkspaceItem(store, body, id) {
  if (!object(body)) throw bad('저장할 기록을 확인해 주세요.');
  return store.transaction(() => {
    const current = readWorkspace(store);
    const input = { ...body.item };
    if (!id) input.id = randomUUID();
    const workspace = mutateWorkspace(current, {
      operation: id ? 'update' : 'create', id,
      item: input, links: body.links, expectedRevision: body.expectedRevision,
    }, store.careers());
    bounded(exportWorkspaceArchive(store, { workspace }));
    store.putWorkspace(workspace);
    return workspace;
  });
}
export function deleteWorkspaceItem(store, id, expectedRevision) {
  return store.transaction(() => {
    const workspace = mutateWorkspace(readWorkspace(store), { operation: 'delete', id, expectedRevision }, store.careers());
    store.putWorkspace(workspace); return workspace;
  });
}
export function deleteWorkspaceCareer(store, id) {
  return store.transaction(() => {
    const before = readWorkspace(store);
    store.deleteCareer(id);
    const workspace = normalizeWorkspace(before, {
      careerIds: store.careers().map(career => career.id), pruneMissingCareerLinks: true,
      revision: before.links.some(link => link.from === `career:${id}` || link.to === `career:${id}`) ? before.revision + 1 : before.revision,
    });
    if (!equivalent(before, workspace)) store.putWorkspace(workspace);
  });
}
export function exportWorkspaceArchive(store, overrides = {}) {
  const careers = overrides.careers || store.careers();
  const workspace = overrides.workspace || readWorkspace(store);
  const { revision: _revision, ...workspacePayload } = workspace;
  const documents = overrides.documents || store.documents();
  const createdAt = new Date().toISOString();
  const metadata = documents.map(document => publicMetadata(document, careers));
  // JSON and full ZIP both need to fit their actual compact manifest, including
  // inverse career links and the ZIP-only original paths.
  bounded({ format: 'career-archive', version: 1, createdAt, careers,
    documents: metadata.map((document, index) => ({ ...document, filePath: `originals/${documents[index].storageName}` })),
    workspace: workspacePayload });
  return bounded({ format: 'introduce-me-workspace', version: 1, createdAt,
    careers, documents: metadata, workspace: workspacePayload });
}
function importedCareer(input) {
  if (!object(input) || !validId(input.id) || typeof input.title !== 'string' || !Array.isArray(input.documentIds)
    || input.documentIds.length > 1000 || input.documentIds.some(id => !validId(id))) throw bad('가져올 경력과 공문 연결이 올바르지 않습니다.');
  for (const field of ['organization', 'role', 'startDate', 'endDate', 'description', 'source'])
    if (input[field] !== undefined && typeof input[field] !== 'string') throw bad('경력 문자열 항목의 형식이 올바르지 않습니다.');
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string'))) throw bad('경력 태그는 문자열 목록이어야 합니다.');
  const career = normalizeCareer({ ...input, verified: input.verified ?? false });
  if (career.startDate && career.endDate && career.endDate < career.startDate) throw bad('경력 종료일이 시작일보다 빠릅니다.');
  return career;
}
function importedDocuments(documents) {
  const ids = new Set(), hashes = new Set();
  return documents.map(document => {
    if (!object(document) || !validId(document.id) || ids.has(document.id)
      || typeof document.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(document.sha256) || hashes.has(document.sha256)
      || typeof document.name !== 'string' || !document.name.trim() || /[\\/\u0000-\u001f]/.test(document.name)
      || !Number.isSafeInteger(document.size) || document.size < 0 || document.size > 25 * 1024 * 1024)
      throw bad('가져올 공문의 ID, 파일명, 크기, 무결성 정보를 확인해 주세요.');
    if (Object.hasOwn(document, 'storageName') || Object.hasOwn(document, 'filePath'))
      throw bad('JSON에는 원본 파일 경로를 지정할 수 없습니다. 원본 복원에는 ZIP 백업을 사용해 주세요.');
    if (document.driveFileId !== undefined && (typeof document.driveFileId !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(document.driveFileId)))
      throw bad('드라이브 원본 파일 ID가 올바르지 않습니다.');
    for (const field of ['mime', 'createdAt', 'text', 'analysisStatus'])
      if (document[field] !== undefined && typeof document[field] !== 'string') throw bad('공문 메타데이터의 문자열 형식이 올바르지 않습니다.');
    ids.add(document.id); hashes.add(document.sha256);
    return document;
  });
}

/** Metadata imports never create or redirect local original-file references. */
export function importWorkspaceArchive(store, archive, expectedRevision) {
  if (!object(archive) || archive.version !== 1 || !['introduce-me-workspace', 'career-archive', 'career-drive-snapshot'].includes(archive.format)
    || !Array.isArray(archive.careers) || archive.careers.length > MAX_CAREERS
    || !Array.isArray(archive.documents) || archive.documents.length > MAX_DOCUMENTS)
    throw bad('지원하는 전체 JSON 또는 경력 JSON 파일을 선택해 주세요.');
  bounded(archive);
  const incomingCareers = archive.careers.map(importedCareer);
  if (new Set(incomingCareers.map(career => career.id)).size !== incomingCareers.length) throw bad('JSON에 중복된 경력 ID가 있습니다.');
  const incomingDocuments = importedDocuments(archive.documents);
  if (archive.format === 'introduce-me-workspace' && archive.workspace === undefined) throw bad('JSON의 작업 기록을 찾을 수 없습니다.');
  return store.transaction(() => {
    const current = readWorkspace(store);
    revision(current, expectedRevision);
    const careers = store.careers(), documents = store.documents();
    const careerById = new Map(careers.map(career => [career.id, career]));
    const documentsById = new Map(documents.map(document => [document.id, document]));
    const documentsByHash = new Map(documents.map(document => [document.sha256, document]));
    const conflicts = [], documentIds = new Map();
    for (const document of incomingDocuments) {
      const existing = documentsById.get(document.id);
      if (existing && existing.sha256 !== document.sha256) {
        conflicts.push({ ref: `document:${document.id}`, reason: '같은 ID의 다른 원본이 있어 현재 공문을 유지했습니다.' });
        documentIds.set(document.id, null); continue;
      }
      const exact = existing || documentsByHash.get(document.sha256);
      if (!exact || exact.size !== document.size) {
        conflicts.push({ ref: `document:${document.id}`, reason: '이 보관함에 원본이 없어 추가하지 않았습니다. 원본이 포함된 ZIP 백업을 이용해 주세요.' });
        documentIds.set(document.id, null); continue;
      }
      documentIds.set(document.id, exact.id);
      if (existing && ['name', 'mime', 'createdAt', 'text', 'analysisStatus', 'driveFileId'].some(field => document[field] !== undefined && (document[field] || '') !== (existing[field] || '')))
        conflicts.push({ ref: `document:${document.id}`, reason: '같은 원본의 공문 정보가 달라 현재 파일명과 설명을 유지했습니다.' });
    }
    const incomingWorkspace = normalizeWorkspace(archive.workspace ?? emptyWorkspace(), {
      careerIds: [...new Set([...careers, ...incomingCareers].map(career => career.id))],
    });
    const newCareers = [];
    for (const input of incomingCareers) {
      const mapped = input.documentIds.map(id => documentIds.has(id) ? documentIds.get(id) : documentsById.has(id) ? id : null);
      if (mapped.some(id => id === null)) {
        conflicts.push({ ref: `career:${input.id}`, reason: '연결할 공문 원본이 없어 이 경력을 추가하거나 변경하지 않았습니다.' });
        continue;
      }
      const career = normalizeCareer({ ...input, documentIds: mapped });
      const existing = careerById.get(career.id);
      if (existing) {
        if (!equivalent(existing, career)) conflicts.push({ ref: `career:${career.id}`, reason: '같은 ID의 경력이 달라 현재 내용을 유지했습니다.' });
      } else {
        newCareers.push(career); careerById.set(career.id, career);
      }
    }
    const mergedCareers = [...careers, ...newCareers];
    if (mergedCareers.length > MAX_CAREERS) throw bad('경력 항목 수가 보관 한도를 초과합니다.');
    const availableCareers = new Set(mergedCareers.map(career => career.id));
    const incomingLinks = incomingWorkspace.links.filter(link => {
      const missing = [link.from, link.to].filter(ref => ref.startsWith('career:') && !availableCareers.has(ref.slice(7)));
      for (const ref of missing) conflicts.push({ ref, reason: '추가되지 않은 경력을 가리키는 연결은 가져오지 않았습니다.' });
      return !missing.length;
    });
    const merged = mergeWorkspaceData(current, { ...incomingWorkspace, links: incomingLinks }, mergedCareers);
    const workspace = { ...merged.workspace, revision: current.revision + 1 };
    bounded(exportWorkspaceArchive(store, { careers: mergedCareers, workspace }));
    for (const career of newCareers) store.putCareer(career);
    store.putWorkspace(workspace);
    return {
      workspace, conflicts: [...conflicts, ...merged.conflicts],
      added: { careers: newCareers.length, documents: 0, ...merged.added },
    };
  });
}
