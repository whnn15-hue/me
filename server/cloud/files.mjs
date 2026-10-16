import { isHtmlBytes } from '../../shared/html.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import Busboy from 'busboy';
import { extractText } from '../extract.mjs';
import { exportBackup, restoreBackup, ALLOWED_EXTENSIONS } from '../backup.mjs';

export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_ARCHIVE_SIZE = 200 * 1024 * 1024;
export const fault = (message, status = 400) => Object.assign(new Error(message), { status });
export const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const MIME = { '.pdf': 'application/pdf', '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.hwp': 'application/x-hwp', '.hwpx': 'application/vnd.hancom.hwpx', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.cell': 'application/vnd.hancom.cell', '.html': 'text/html', '.htm': 'text/html', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export function fileName(raw) { return String(raw || '').replace(/[\/\\\u0000-\u001f]/g, '_').slice(0, 300); }
export function validateFile(file) {
  const name = fileName(file.originalname), extension = extname(name).toLowerCase(), magic = file.buffer.subarray(0, 12);
  if (!ALLOWED_EXTENSIONS.has(extension)) throw fault('PDF, PPT, HTML, HWP/HWPX, Word, Excel, 한셀, 텍스트 또는 이미지 파일을 올려 주세요.');
  if (!file.buffer.length) throw fault('비어 있는 파일은 보관할 수 없습니다.');
  const valid = extension === '.txt' || ['.html', '.htm'].includes(extension) && isHtmlBytes(file.buffer) || extension === '.pdf' && file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')) || ['.hwpx', '.docx', '.xlsx', '.cell', '.pptx'].includes(extension) && magic.subarray(0, 2).toString() === 'PK' || ['.hwp', '.ppt'].includes(extension) && magic.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) || extension === '.png' && magic.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || ['.jpg', '.jpeg'].includes(extension) && magic[0] === 0xff && magic[1] === 0xd8 || extension === '.webp' && magic.subarray(0, 4).toString() === 'RIFF' && magic.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw fault('파일 내용과 확장자가 일치하지 않습니다.');
  return { name, extension, mime: MIME[extension] };
}

// Cloud Functions already consumed the stream into rawBody. Busboy handles that
// representation as well as a normal Express request used by local validation.
export function multipart(field) {
  return (req, res, next) => {
    let parser;
    try { parser = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 20, fieldSize: 1024 * 1024, parts: 21 } }); }
    catch { next(fault('파일 업로드 요청이 올바르지 않습니다.')); return; }
    const files = []; const body = Object.create(null); let error;
    const fail = message => { error ||= fault(message, 413); };
    parser.on('file', (name, stream, info) => {
      const chunks = []; let size = 0;
      if (name !== field) error ||= fault('파일 업로드 항목이 올바르지 않습니다.');
      stream.on('limit', () => fail('공문 및 HWPX 양식은 25MB까지 지원합니다.'));
      stream.on('data', chunk => { size += chunk.length; if (size <= MAX_FILE_SIZE) chunks.push(chunk); });
      stream.on('end', () => { if (!stream.truncated && name === field) files.push({ originalname: info.filename, mimetype: info.mimeType, size, buffer: Buffer.concat(chunks) }); });
    });
    parser.on('field', (name, value, info) => { if (info.valueTruncated || info.nameTruncated) fail('양식 입력 내용이 너무 큽니다.'); else body[name] = value; });
    parser.on('filesLimit', () => fail('한 번에 파일 하나씩 올려 주세요.'));
    parser.on('fieldsLimit', () => fail('업로드 항목이 너무 많습니다.'));
    parser.on('partsLimit', () => fail('업로드 항목이 너무 많습니다.'));
    let finished = false;
    const finish = reason => { if (finished) return; finished = true; if (reason || error) next(reason || error); else { req.body = body; req.files = files; req.file = files[0]; next(); } };
    parser.on('error', () => finish(fault('파일 업로드 내용을 읽지 못했습니다.')));
    parser.on('close', () => finish());
    if (Buffer.isBuffer(req.rawBody)) {
      if (req.rawBody.length > 32 * 1024 * 1024) { finish(fault('요청 크기가 제한을 초과했습니다.', 413)); return; }
      parser.end(req.rawBody);
    } else req.pipe(parser);
  };
}

export async function inTemp(action) {
  const directory = await mkdtemp(join(tmpdir(), 'career-cloud-'));
  try { await mkdir(join(directory, 'originals'), { mode: 0o700 }); return await action(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
export async function cloudExtract(buffer, name) {
  if (extname(name).toLowerCase() === '.pdf') {
    let task;
    try {
      const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const packageRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
      task = pdf.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true, cMapUrl: join(packageRoot, 'cmaps') + '/', cMapPacked: true, standardFontDataUrl: join(packageRoot, 'standard_fonts') + '/' });
      const document = await task.promise; const pieces = []; let size = 0;
      for (let page = 1; page <= Math.min(document.numPages, 200) && size < 100000; page++) {
        const content = await (await document.getPage(page)).getTextContent(); const text = content.items.map(item => item.str || '').join(' '); pieces.push(text); size += text.length;
      }
      const text = pieces.join('\n').slice(0, 100000);
      return { text, analysisStatus: text.trim() ? 'text-ready' : 'ocr-needed' };
    } catch { return { text: '', analysisStatus: 'extraction-unavailable' }; }
    finally { await task?.destroy().catch(() => {}); }
  }
  return inTemp(async directory => { const path = join(directory, `input${extname(name)}`); await writeFile(path, buffer); return extractText(path, name); });
}

// Existing archive validators operate on this temporary adapter only. No SQLite
// database or durable files are created on a serverless instance.
function temporaryStore(directory, snapshot = { careers: [], documents: [] }) {
  let careers = new Map(snapshot.careers.map(value => [value.id, value])); let documents = new Map(snapshot.documents.map(value => [value.id, value]));
  return {
    dataDir: directory, careers: () => [...careers.values()], documents: () => [...documents.values()],
    putCareer: value => careers.set(value.id, value), putDocument: value => documents.set(value.id, value),
    db: { exec: () => { careers.clear(); documents.clear(); } },
    transaction: action => { const previous = [new Map(careers), new Map(documents)]; try { return action(); } catch (error) { [careers, documents] = previous; throw error; } },
  };
}
export const originalPath = (uid, storageName) => `careerArchives/users/${uid}/originals/${storageName}`;
export async function captureBackup(repo, bucket, selectedIds) {
  const snapshot = await repo.snapshot();
  if (selectedIds && (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id => !snapshot.careers.some(career => career.id === id)))) throw fault('증빙을 모을 경력을 선택해 주세요.');
  return inTemp(async directory => {
    const selectedDocs = selectedIds ? new Set(snapshot.careers.filter(career => selectedIds.includes(career.id)).flatMap(career => career.documentIds)) : null;
    let total = 0;
    for (const document of snapshot.documents.filter(document => !selectedDocs || selectedDocs.has(document.id))) {
      total += document.size;
      if (document.size > MAX_FILE_SIZE || total > MAX_ARCHIVE_SIZE) throw fault('백업 합계가 200MB를 초과했습니다. 경력별 증빙 묶음을 이용해 주세요.', 413);
      const [buffer] = await bucket.file(originalPath(repo.uid, document.storageName)).download({ validation: 'crc32c' });
      if (buffer.length !== document.size || sha256(buffer) !== document.sha256) throw fault('보관된 원본 파일의 크기·무결성 검증에 실패했습니다.');
      await writeFile(join(directory, 'originals', document.storageName), buffer, { flag: 'wx', mode: 0o600 });
    }
    return exportBackup(temporaryStore(directory, snapshot), selectedIds);
  });
}
export async function restoreCloudBackup(repo, bucket, buffer, expected) {
  return inTemp(async directory => {
    const store = temporaryStore(directory); await restoreBackup(store, buffer);
    for (const document of store.documents()) {
      const original = await readFile(join(directory, 'originals', document.storageName));
      await bucket.file(originalPath(repo.uid, document.storageName)).save(original, { resumable: false, validation: 'crc32c', contentType: document.mime, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { sha256: document.sha256 } } });
    }
    return repo.stageAndActivate({ careers: store.careers(), documents: store.documents() }, expected);
  });
}
export async function signedDownload(bucket, uid, buffer, fileName, mime = 'application/zip') {
  const file = bucket.file(`careerArchives/users/${uid}/exports/${randomUUID()}`);
  await file.save(buffer, { resumable: false, validation: 'crc32c', contentType: mime, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { deleteAfter: new Date(Date.now() + 86400000).toISOString() } } });
  const [downloadUrl] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 5 * 60000, responseDisposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(fileName)}`, responseType: mime });
  return { downloadUrl, fileName };
}
