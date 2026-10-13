import express from 'express';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { CloudStore, ensureLinks } from './store.mjs';
import { publicDocument, normalizeCareer } from '../store.mjs';
import { analyze } from '../extract.mjs';
import { inspectHwpx, fillHwpx } from '../hwpx.mjs';
import { networkFetch } from '../auth.mjs';
import { createCloudDrive } from './drive.mjs';
import { fault, sha256, fileName, validateFile, multipart, cloudExtract, inTemp, originalPath, captureBackup, restoreCloudBackup, signedDownload, MAX_ARCHIVE_SIZE } from './files.mjs';

const OWNER_MESSAGE = '이 앱은 지정된 본인 구글 계정으로만 사용할 수 있습니다.';
function configuredOrigin(raw) {
  try { const url = new URL(raw); return url.protocol === 'https:' && url.origin === raw && !url.username && !url.password ? url.origin : null; } catch { return null; }
}
export function createCloudApp({ db, bucket, auth, config, storeFactory = (uid, email) => new CloudStore(db, uid, email, config.seedCareers || []), fetcher = networkFetch, extract = cloudExtract }) {
  const app = express(); app.disable('x-powered-by');
  const origin = configuredOrigin(config.appUrl); const owner = String(config.ownerEmail || '').trim().toLowerCase();
  const configured = Boolean(origin && owner && config.projectId && config.storageBucket && db && bucket && auth);
  const drive = createCloudDrive({ db, config, storeFactory, fetcher, captureBackup: repo => captureBackup(repo, bucket) });
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', Vary: 'Origin' });
    const requestOrigin = req.get('origin');
    if (requestOrigin && requestOrigin !== origin) return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
    if (requestOrigin && origin) res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '600' });
    if (req.method === 'OPTIONS') return res.sendStatus(configured && requestOrigin === origin ? 204 : 403);
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  const identify = async req => {
    if (!configured) throw fault('Firebase 프로젝트, 저장소, 앱 주소와 본인 계정을 먼저 설정해 주세요.', 503);
    const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
    if (!match) throw fault('본인 구글 계정으로 로그인해 주세요.', 401);
    let token;
    try { token = await auth.verifyIdToken(match[1], true); } catch { throw fault('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401); }
    if (token.email_verified !== true || String(token.email || '').trim().toLowerCase() !== owner || token.firebase?.sign_in_provider !== 'google.com') throw fault(OWNER_MESSAGE, 403);
    req.user = { uid: token.uid, email: owner, name: String(token.name || token.email).slice(0, 100) };
    req.repo = storeFactory(token.uid, owner);
    await req.repo.ensureInitialized();
  };
  app.get('/api/status', async (req, res) => {
    const base = { mode: 'firebase', user: null, googleConfigured: configured, ownerConfigured: Boolean(owner), aiConfigured: Boolean(config.aiEnabled && config.aiKey), driveConfigured: configured && drive.configured, driveConnected: false, lastBackup: null };
    if (!req.get('Authorization')) return res.json(base);
    await identify(req);
    res.json({ ...base, user: req.user, ...(await drive.status(req.repo)) });
  });
  // OAuth callback validates a single-use Firestore state plus PKCE; it cannot
  // access career data or issue a Firebase login session.
  app.get('/api/auth/callback', drive.callback);
  app.use('/api', async (req, res, next) => { try { await identify(req); next(); } catch (error) { next(error); } });
  app.get('/api/data', async (req, res) => { const snapshot = await req.repo.snapshot(); res.json({ careers: snapshot.careers, documents: snapshot.documents.map(document => publicDocument(document, snapshot.careers)) }); });
  app.post('/api/careers', async (req, res) => {
    const career = normalizeCareer({ ...req.body, id: randomUUID() });
    await req.repo.mutate(state => { ensureLinks(career, state.documents); state.careers.set(career.id, career); });
    res.status(201).json(career);
  });
  app.put('/api/careers/:id', async (req, res) => {
    const result = await req.repo.mutate(state => { const previous = state.careers.get(req.params.id); if (!previous) throw fault('경력을 찾을 수 없습니다.', 404); const career = normalizeCareer(req.body, previous); ensureLinks(career, state.documents); state.careers.set(career.id, career); return career; }); res.json(result);
  });
  app.delete('/api/careers/:id', async (req, res) => {
    await req.repo.mutate(state => { if (!state.careers.delete(req.params.id)) throw fault('경력을 찾을 수 없습니다.', 404); }); res.json({ ok: true });
  });
  app.post('/api/documents', multipart('files'), async (req, res) => {
    const file = req.file; if (!file) throw fault('보관할 파일을 선택해 주세요.');
    const { name, extension, mime } = validateFile(file); const hash = sha256(file.buffer);
    const snapshot = await req.repo.snapshot(); const existing = snapshot.documents.find(document => document.sha256 === hash);
    if (existing) return res.status(201).json({ documents: [publicDocument(existing, snapshot.careers)], duplicates: [name] });
    const id = randomUUID(); const storageName = `${id}${extension}`;
    await bucket.file(originalPath(req.user.uid, storageName)).save(file.buffer, { resumable: false, validation: 'crc32c', contentType: mime, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { sha256: hash } } });
    const extraction = await extract(file.buffer, name);
    const document = { id, name, size: file.buffer.length, mime, storageName, sha256: hash, createdAt: new Date().toISOString(), ...extraction };
    const result = await req.repo.mutate(state => {
      const duplicate = [...state.documents.values()].find(value => value.sha256 === hash);
      if (duplicate) return { documents: [publicDocument(duplicate, [...state.careers.values()])], duplicates: [name] };
      state.documents.set(id, document); return { documents: [publicDocument(document, [...state.careers.values()])], duplicates: [] };
    });
    // Unreferenced immutable objects from a competing upload are deliberately
    // retained; deleting them here could race a snapshot/restore operation.
    res.status(201).json(result);
  });
  app.post('/api/documents/:id/link', async (req, res) => {
    const result = await req.repo.mutate(state => {
      if (!state.documents.has(req.params.id)) throw fault('공문을 찾을 수 없습니다.', 404);
      const previous = state.careers.get(req.body.careerId); if (!previous) throw fault('연결할 경력을 찾을 수 없습니다.', 404);
      const career = normalizeCareer({ documentIds: [...previous.documentIds, req.params.id] }, previous); state.careers.set(career.id, career); return career;
    }); res.json(result);
  });
  app.get('/api/documents/:id/file', async (req, res) => {
    const snapshot = await req.repo.snapshot(); const document = snapshot.documents.find(value => value.id === req.params.id); if (!document) throw fault('공문을 찾을 수 없습니다.', 404);
    const [downloadUrl] = await bucket.file(originalPath(req.user.uid, document.storageName)).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 5 * 60000, responseDisposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(document.name)}`, responseType: document.mime });
    res.json({ downloadUrl, fileName: document.name });
  });
  app.delete('/api/documents/:id', async (req, res) => {
    await req.repo.mutate(state => {
      if (!state.documents.has(req.params.id)) throw fault('공문을 찾을 수 없습니다.', 404);
      for (const career of state.careers.values()) if (career.documentIds.includes(req.params.id)) state.careers.set(career.id, normalizeCareer({ documentIds: career.documentIds.filter(id => id !== req.params.id) }, career));
      state.documents.delete(req.params.id);
    }); res.json({ ok: true });
  });
  app.post('/api/analyze', async (req, res) => {
    const snapshot = await req.repo.snapshot(); const document = req.body.documentId ? snapshot.documents.find(value => value.id === req.body.documentId) : null;
    if (req.body.documentId && !document) throw fault('공문을 찾을 수 없습니다.', 404);
    if (!document && !String(req.body.text || '').trim()) throw fault('분석할 활동 내용이나 공문을 선택해 주세요.');
    const run = path => analyze({ text: req.body.text, document, path, apiKey: config.aiEnabled ? config.aiKey : '', fetcher });
    const result = document && config.aiEnabled && config.aiKey ? await inTemp(async directory => {
      const [buffer] = await bucket.file(originalPath(req.user.uid, document.storageName)).download({ validation: 'crc32c' });
      if (sha256(buffer) !== document.sha256) throw fault('공문 원본의 무결성 검증에 실패했습니다.');
      const path = join(directory, `input${extname(document.name)}`); await writeFile(path, buffer); return run(path);
    }) : await run(null);
    res.json(result);
  });
  app.get('/api/backup/export', async (req, res) => res.json(await signedDownload(bucket, req.user.uid, await captureBackup(req.repo, bucket), `career-backup-${new Date().toISOString().slice(0, 10)}.zip`)));
  app.post('/api/backup/upload-url', async (req, res) => {
    if (!Number.isSafeInteger(req.body.size) || req.body.size <= 0 || req.body.size > MAX_ARCHIVE_SIZE || extname(fileName(req.body.name)).toLowerCase() !== '.zip') throw fault('복원할 백업 ZIP 파일은 200MB 이하여야 합니다.');
    const uploadId = randomUUID(); const expiresAt = Date.now() + 15 * 60000; const storagePath = `careerArchives/users/${req.user.uid}/restore/${uploadId}.zip`;
    await req.repo.upload(uploadId).set({ storagePath, size: req.body.size, expiresAt, ownerUid: req.user.uid });
    const [uploadUrl] = await bucket.file(storagePath).getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType: 'application/zip' });
    res.json({ uploadUrl, uploadId, expiresAt, maxSize: MAX_ARCHIVE_SIZE });
  });
  app.post('/api/backup/restore', async (req, res) => {
    const ref = req.repo.upload(req.body.uploadId); const row = await ref.get(); const upload = row.exists ? row.data() : null;
    if (!upload || upload.ownerUid !== req.user.uid || upload.expiresAt < Date.now() || upload.storagePath !== `careerArchives/users/${req.user.uid}/restore/${req.body.uploadId}.zip`) throw fault('백업 업로드가 만료되었거나 올바르지 않습니다. 다시 올려 주세요.');
    const expected = await req.repo.snapshot(); const file = bucket.file(upload.storagePath); const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== upload.size || Number(metadata.size) > MAX_ARCHIVE_SIZE) throw fault('업로드한 백업의 크기가 일치하지 않습니다.');
    const generation = metadata.generation; const [buffer] = await bucket.file(upload.storagePath, generation ? { generation } : undefined).download({ validation: 'crc32c' });
    if (buffer.length !== upload.size) throw fault('업로드한 백업의 크기가 일치하지 않습니다.');
    const result = await restoreCloudBackup(req.repo, bucket, buffer, expected);
    await ref.delete(); await file.delete({ ignoreNotFound: true, ...(generation ? { ifGenerationMatch: generation } : {}) }).catch(() => {});
    res.json(result);
  });
  app.post('/api/resume/evidence', async (req, res) => res.json(await signedDownload(bucket, req.user.uid, await captureBackup(req.repo, bucket, req.body.careerIds), `경력-증빙-${new Date().toISOString().slice(0, 10)}.zip`)));
  app.post('/api/resume/hwpx/inspect', multipart('file'), async (req, res) => {
    if (!req.file || extname(fileName(req.file.originalname)).toLowerCase() !== '.hwpx') throw fault('HWPX 양식을 올려 주세요. HWP는 한글에서 HWPX로 저장해 주세요.');
    res.json(await inspectHwpx(req.file.buffer));
  });
  app.post('/api/resume/hwpx/fill', multipart('file'), async (req, res) => {
    if (!req.file || extname(fileName(req.file.originalname)).toLowerCase() !== '.hwpx') throw fault('HWPX 양식을 올려 주세요.');
    let mappings; try { mappings = JSON.parse(req.body.mappings || '{}'); } catch { throw fault('입력할 양식 내용이 올바르지 않습니다.'); }
    const buffer = await fillHwpx(req.file.buffer, mappings); const name = `작성-${fileName(req.file.originalname)}`;
    if (buffer.length > 8 * 1024 * 1024) return res.json(await signedDownload(bucket, req.user.uid, buffer, name, 'application/vnd.hancom.hwpx'));
    res.attachment(name).type('application/vnd.hancom.hwpx').send(buffer);
  });
  app.post('/api/auth/drive/start', drive.start);
  app.post('/api/auth/drive/disconnect', drive.disconnect);
  app.post('/api/backup/drive', async (req, res) => res.json(await drive.backup(req.repo)));
  app.post('/api/auth/logout', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ error: '요청한 기능을 찾을 수 없습니다.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.code === 'INVALID_HWPX' ? 400 : [404, 5].includes(error.code) || error.code === 'ENOENT' ? 404 : 500);
    if (status >= 500) console.error('careerApi request failed', { code: error.code || '', type: error.name || 'Error' });
    res.status(status).json({ error: status < 500 || error.status ? error.message : '요청을 처리하지 못했습니다. 설정과 서비스 상태를 확인해 주세요.' });
  });
  return { app, drive, configured };
}
