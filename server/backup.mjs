import JSZip from 'jszip';
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { normalizeCareer, publicDocument, cleanText } from './store.mjs';
import { networkFetch } from './auth.mjs';
import { normalizeWorkspace } from '../shared/workspace.mjs';

export const ALLOWED_EXTENSIONS = new Set(['.pdf', '.hwp', '.hwpx', '.docx', '.txt', '.xlsx', '.png', '.jpg', '.jpeg', '.webp']);
const MAX_BACKUP_SIZE = 200 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 5 * 1024 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_CAREERS = 100000;
const MAX_DOCUMENTS = 10000;
const MAX_ENTRIES = MAX_DOCUMENTS + 10;
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const bad = message => Object.assign(new Error(message), { status: 400 });
const tooLarge = message => Object.assign(new Error(message), { status: 413 });

// Bound the number and declared size of entries before JSZip creates objects or
// inflates data. Backups this small do not need split archives or ZIP64.
function inspectArchiveBounds(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 22 || buffer.length > MAX_BACKUP_SIZE) throw bad('백업 ZIP 파일은 200MB 이하여야 합니다.');
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 0xffff); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) throw bad('ZIP 백업 파일 목록을 읽을 수 없습니다.');
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  let offset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count
      || count > MAX_ENTRIES || count === 0xffff || size === 0xffffffff || offset === 0xffffffff || offset + size > end) {
    throw bad('분할 ZIP, ZIP64 또는 지나치게 많은 항목이 있는 백업은 지원하지 않습니다.');
  }
  const directoryEnd = offset + size;
  let total = 0;
  const names = new Set();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directoryEnd || buffer.readUInt32LE(offset) !== 0x02014b50) throw bad('ZIP 백업 파일 목록이 손상되었습니다.');
    const nameSize = buffer.readUInt16LE(offset + 28);
    const next = offset + 46 + nameSize + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    if (next > directoryEnd) throw bad('ZIP 백업 파일 목록이 손상되었습니다.');
    const name = buffer.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    const inflated = buffer.readUInt32LE(offset + 24);
    total += inflated;
    if (names.has(name)) throw bad('중복된 파일 경로가 포함된 백업입니다.');
    names.add(name);
    if (total > MAX_BACKUP_SIZE || inflated > (name === 'manifest.json' ? MAX_MANIFEST_SIZE : MAX_FILE_SIZE)) {
      throw bad('백업 항목의 압축 해제 용량이 제한을 초과합니다.');
    }
    offset = next;
  }
  if (offset !== directoryEnd) throw bad('ZIP 백업 파일 목록의 크기가 일치하지 않습니다.');
  return buffer;
}

function readEntry(file, maxBytes, asText = false) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let ended = false; let checksum = 0;
    const stream = file.internalStream('nodebuffer');
    stream.on('data', chunk => {
      if (ended) return;
      size += chunk.length;
      if (size > maxBytes) { ended = true; stream.pause(); reject(bad('백업 항목의 압축 해제 용량이 제한을 초과합니다.')); }
      else { checksum = crc32(chunk, checksum); chunks.push(chunk); }
    });
    stream.on('error', error => { if (!ended) { ended = true; reject(bad('백업 압축 데이터가 손상되었습니다.')); } });
    stream.on('end', () => {
      if (ended) return;
      ended = true;
      if (checksum !== (file._data.crc32 >>> 0)) return reject(bad('백업 항목의 CRC 무결성 검증에 실패했습니다.'));
      const buffer = Buffer.concat(chunks); resolve(asText ? buffer.toString('utf8') : buffer);
    });
    stream.resume();
  });
}

export async function exportBackup(store, selectedIds) {
  const allCareers = store.careers();
  const careers = selectedIds ? allCareers.filter(c => selectedIds.includes(c.id)) : allCareers;
  const documentIds = new Set(careers.flatMap(c => c.documentIds));
  const documents = selectedIds ? store.documents().filter(d => documentIds.has(d.id)) : store.documents();
  if (careers.length > MAX_CAREERS || documents.length > MAX_DOCUMENTS) throw tooLarge('백업 항목 수가 복원 가능 범위를 초과했습니다. 경력별 증빙 묶음을 이용해 주세요.');
  const zip = new JSZip();
  const manifest = { format: 'career-archive', version: 1, createdAt: new Date().toISOString(), careers, documents: documents.map(document => ({ ...publicDocument(document, careers), sha256: document.sha256, filePath: `originals/${document.storageName}` })) };
  if (!selectedIds) {
    const { revision: _revision, ...workspace } = normalizeWorkspace(store.workspace?.(), { careerIds: careers.map(career => career.id), pruneMissingCareerLinks: true });
    manifest.workspace = workspace;
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_SIZE) throw tooLarge('경력·공문 목록이 복원 가능한 5MB를 초과했습니다. 필요한 경력만 선택해 증빙 묶음을 내려받아 주세요.');
  let total = manifestBytes.length;
  zip.file('manifest.json', manifestBytes);
  if (selectedIds) {
    const escape = value => `"${String(value || '').replaceAll('"', '""')}"`;
    const rows = [['활동명', '분류', '기관', '역할', '시작', '종료', '내용', '증빙 수'], ...careers.map(c => [c.title, c.category, c.organization, c.role, c.startDate, c.endDate, c.description, c.documentIds.length])];
    // Prefix spreadsheet formula-like cells to keep user text inert when opened in Excel.
    const csv = Buffer.from('\uFEFF' + rows.map(row => row.map(value => escape(/^[=+@-]/.test(String(value || '')) ? `'${value}` : value)).join(',')).join('\r\n'));
    if (csv.length > MAX_FILE_SIZE) throw tooLarge('증빙 목록 CSV가 복원 가능한 25MB를 초과했습니다. 경력을 나누어 내려받아 주세요.');
    total += csv.length; zip.file('경력목록.csv', csv);
  }
  const sizes = [];
  // Preflight sizes before reading originals into memory. Metadata and CSV count
  // toward the same inflated limit used by restore.
  for (const document of documents) {
    const size = (await stat(join(store.dataDir, 'originals', document.storageName))).size;
    if (size > MAX_FILE_SIZE) throw tooLarge('원본 파일이 복원 가능한 25MB를 초과했습니다.');
    total += size; sizes.push(size);
    if (total > MAX_BACKUP_SIZE) throw tooLarge('원본·경력 목록·CSV의 백업 합계가 200MB를 초과했습니다. 경력별 증빙 묶음을 이용해 주세요.');
  }
  for (let index = 0; index < documents.length; index++) {
    const document = documents[index];
    const file = await readFile(join(store.dataDir, 'originals', document.storageName));
    if (file.length !== sizes[index] || sha(file) !== document.sha256) throw bad('보관된 원본 파일의 크기·무결성 검증에 실패했습니다.');
    zip.file(`originals/${document.storageName}`, file);
  }
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 5 } });
  if (output.length > MAX_BACKUP_SIZE) throw tooLarge('압축한 백업 ZIP이 200MB를 초과했습니다. 경력을 나누어 내려받아 주세요.');
  return output;
}
export async function restoreBackup(store, buffer) {
  buffer = inspectArchiveBounds(buffer);
  let zip;
  try { zip = await JSZip.loadAsync(buffer, { checkCRC32: false }); } catch { throw bad('올바른 ZIP 백업 파일이 아닙니다.'); }
  let total = 0;
  for (const [name, file] of Object.entries(zip.files)) {
    const original = file.unsafeOriginalName || name;
    if (original.includes('\\') || original.startsWith('/') || original.split('/').some(p => p === '..') || /^[A-Za-z]:/.test(original)) throw bad('안전하지 않은 파일 경로가 포함된 백업입니다.');
    const size = file._data?.uncompressedSize || 0; total += size;
    if (total > MAX_BACKUP_SIZE || size > MAX_FILE_SIZE && name !== 'manifest.json') throw bad('백업의 압축 해제 용량이 제한을 초과합니다.');
  }
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile || (manifestFile._data?.uncompressedSize || 0) > MAX_MANIFEST_SIZE) throw bad('경력 백업의 manifest.json을 찾을 수 없습니다.');
  let manifest;
  try { manifest = JSON.parse(await readEntry(manifestFile, MAX_MANIFEST_SIZE, true)); } catch (error) { if (error.status) throw error; throw bad('백업 목록을 읽을 수 없습니다.'); }
  if (!manifest || manifest.format !== 'career-archive' || manifest.version !== 1 || !Array.isArray(manifest.careers) || !Array.isArray(manifest.documents) || manifest.careers.length > MAX_CAREERS || manifest.documents.length > MAX_DOCUMENTS) throw bad('지원하지 않는 경력 백업 형식입니다.');
  if (manifest.evidenceImport != null) throw bad('증빙 추가 묶음은 정리한 증빙 가져오기에서 추가해 주세요. 전체 기록 복원에는 사용할 수 없습니다.');
  const idOK = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
  const docIds = new Set(), recordIds = new Set(), hashes = new Set();
  const docs = [], careers = [];
  let restoredBytes = 0;
  for (const document of manifest.documents) {
    if (!document || !idOK(document.id) || docIds.has(document.id) || typeof document.filePath !== 'string' || !/^originals\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(document.filePath)) throw bad('백업 파일 목록이 올바르지 않습니다.');
    const extension = extname(document.filePath);
    if (!ALLOWED_EXTENSIONS.has(extension) || !zip.file(document.filePath)) throw bad('백업 원본 파일이 없거나 지원하지 않는 형식입니다.');
    const file = await readEntry(zip.file(document.filePath), MAX_FILE_SIZE);
    restoredBytes += file.length; if (restoredBytes > MAX_BACKUP_SIZE) throw bad('백업 원본의 합계가 200MB를 초과합니다.');
    if (file.length > MAX_FILE_SIZE || sha(file) !== document.sha256 || hashes.has(document.sha256)) throw bad('백업 원본 파일의 크기·중복·무결성 검증에 실패했습니다.');
    docIds.add(document.id); hashes.add(document.sha256);
    docs.push({ document: { id: document.id, name: cleanText(document.name, 300), size: file.length, mime: cleanText(document.mime, 100), createdAt: cleanText(document.createdAt, 50), text: cleanText(document.text, 100000), analysisStatus: cleanText(document.analysisStatus, 50), sha256: document.sha256, storageName: `${document.id}${extension}` }, file });
  }
  for (const input of manifest.careers) {
    if (!input || !idOK(input.id) || recordIds.has(input.id) || !Array.isArray(input.documentIds) || input.documentIds.some(id => !docIds.has(id))) throw bad('백업 경력 목록 또는 증빙 연결이 올바르지 않습니다.');
    recordIds.add(input.id); careers.push(normalizeCareer(input));
  }
  const previousWorkspace = store.workspace?.() ?? normalizeWorkspace(undefined);
  if (!Number.isSafeInteger(previousWorkspace.revision) || previousWorkspace.revision >= Number.MAX_SAFE_INTEGER) throw bad('작업 기록 버전을 확인할 수 없습니다.');
  // Old archives have no workspace extension. Retain their existing items and
  // only detach career edges whose destination disappears in this full restore.
  const workspace = normalizeWorkspace(manifest.workspace ?? previousWorkspace, {
    careerIds: careers.map(career => career.id), revision: previousWorkspace.revision + 1,
    pruneMissingCareerLinks: manifest.workspace === undefined,
  });
  const detachedLinks = manifest.workspace === undefined ? previousWorkspace.links.length - workspace.links.length : 0;
  if (!store.putWorkspace && (workspace.items.length || workspace.links.length)) throw bad('이 저장 환경에서는 확장 기록을 복원할 수 없습니다. 무료 웹앱 또는 로컬 앱에서 복원해 주세요.');
  // New originals receive fresh names before the transaction. SQLite then switches
  // all references in one commit; interruption cannot leave existing data unreadable.
  const previousNames = store.documents().map(document => document.storageName);
  const created = [];
  let committed = false;
  try {
    for (const item of docs) {
      item.document.storageName = `${randomUUID()}${extname(item.document.storageName)}`;
      const path = join(store.dataDir, 'originals', item.document.storageName);
      await writeFile(path, item.file, { mode: 0o600, flag: 'wx' }); created.push(path);
    }
    store.transaction(() => {
      store.db.exec('DELETE FROM careers; DELETE FROM documents;');
      for (const career of careers) store.putCareer(career);
      for (const item of docs) store.putDocument(item.document);
      store.putWorkspace?.(workspace);
    });
    committed = true;
    for (const name of previousNames) await unlink(join(store.dataDir, 'originals', name)).catch(() => {});
    return { ok: true, careers: careers.length, documents: docs.length, ...(workspace.items.length || detachedLinks ? { workspaceItems: workspace.items.length, detachedWorkspaceLinks: detachedLinks } : {}) };
  } finally { if (!committed) for (const path of created) await unlink(path).catch(() => {}); }

}
export async function backupToDrive(store, auth, createSnapshot = () => exportBackup(store)) {
  const token = await auth.driveAccessToken();
  // Snapshot creation may take a storage lock; release it before Drive requests.
  const buffer = await createSnapshot();
  let folder = store.getSetting('driveFolder');
  const headers = { Authorization: `Bearer ${token}` };
  if (folder) {
    const check = await networkFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder)}?fields=id,trashed`, { headers, signal: AbortSignal.timeout(20000) });
    if (check.status === 404) folder = null;
    else if (!check.ok) throw new Error('드라이브 백업 폴더를 확인하지 못했습니다.');
    else if ((await check.json()).trashed) folder = null;
  }
  if (!folder) {
    const response = await networkFetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '나의 경력 보관함 백업', mimeType: 'application/vnd.google-apps.folder' }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('드라이브 백업 폴더를 만들지 못했습니다.');
    folder = (await response.json()).id; store.setSetting('driveFolder', folder);
  }
  const timestamp = new Date().toISOString();
  const boundary = `career_${randomUUID()}`;
  const metadata = { name: `career-backup-${timestamp.replace(/[:.]/g, '-')}.zip`, parents: [folder] };
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const response = await networkFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('드라이브 백업 업로드에 실패했습니다.');
  const result = await response.json(); store.setSetting('lastBackup', timestamp); store.setSetting('backupError', null);
  return { ok: true, lastBackup: timestamp, name: result.name };
}
