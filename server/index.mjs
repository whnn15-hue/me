import express from 'express';
import multer from 'multer';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { Store, normalizeCareer, publicDocument } from './store.mjs';
import { Auth, networkFetch } from './auth.mjs';
import { extractText, analyze } from './extract.mjs';
import { ALLOWED_EXTENSIONS, exportBackup, restoreBackup, backupToDrive } from './backup.mjs';
import { readWorkspace, saveWorkspaceItem, deleteWorkspaceItem, deleteWorkspaceCareer, exportWorkspaceArchive, importWorkspaceArchive } from './workspace.mjs';

const serverDir = dirname(fileURLToPath(import.meta.url));
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const types = { '.pdf': 'application/pdf', '.hwp': 'application/x-hwp', '.hwpx': 'application/vnd.hancom.hwpx', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.cell': 'application/vnd.hancom.cell', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function fileName(raw) {
  const converted = Buffer.from(raw, 'latin1').toString('utf8');
  const decoded = converted.includes('\ufffd') ? raw : converted;
  return decoded.replace(/[\/\\\u0000-\u001f]/g, '_').slice(0, 300);
}
function validateFile(file) {
  const name = fileName(file.originalname), extension = extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw fault('PDF, HWP/HWPX, Word, Excel, 한셀, 텍스트 또는 이미지 파일을 올려 주세요.');
  if (!file.buffer.length) throw fault('비어 있는 파일은 보관할 수 없습니다.');
  const magic = file.buffer.subarray(0, 12);
  const valid = extension === '.txt' || extension === '.pdf' && file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')) || ['.hwpx', '.docx', '.xlsx', '.cell'].includes(extension) && magic.subarray(0, 2).toString() === 'PK' || extension === '.hwp' && magic.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) || extension === '.png' && magic.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || ['.jpg', '.jpeg'].includes(extension) && magic[0] === 0xff && magic[1] === 0xd8 || extension === '.webp' && magic.subarray(0, 4).toString() === 'RIFF' && magic.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw fault('파일 내용과 확장자가 일치하지 않습니다.');
  return { name, extension, mime: types[extension] };
}
function storageQueue() {
  let tail = Promise.resolve();
  return async () => {
    let unlock;
    const waiting = tail;
    tail = new Promise(resolve => { unlock = resolve; });
    await waiting;
    let released = false;
    return () => { if (!released) { released = true; unlock(); } };
  };
}
export function createApp(overrides = {}) {
  const config = {
    dataDir: resolve(process.env.APP_DATA_DIR || join(serverDir, '..', '.data')),
    seedPath: join(serverDir, 'seed.json'), localMode: process.env.APP_LOCAL_MODE === 'true',
    appUrl: process.env.APP_URL || '', ownerEmail: process.env.OWNER_EMAIL || '', googleClientId: process.env.GOOGLE_CLIENT_ID || '', googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '', aiKey: process.env.APP_AI_KEY || '', encryptionKey: process.env.APP_ENCRYPTION_KEY || '', automaticBackups: true, ...overrides,
  };
  const store = new Store(config.dataDir, config.seedPath), auth = new Auth(store, config);
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); res.set('Cache-Control', 'no-store'); next(); });
  // The archive itself is bounded to 5 MB; leave room for its request envelope.
  app.use('/api/workspace/import', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '1mb' }));
  auth.register(app);
  app.use('/api', auth.accessMiddleware.bind(auth), auth.csrfMiddleware.bind(auth));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10, fields: 20, fieldSize: 1024 * 1024 } });
  const archiveUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 2 } });
  const acquireStorage = storageQueue();
  // Keep the lock until both the operation and response have finished. A client
  // disconnect must not unlock storage while an awaited file write still runs.
  const locked = handler => async (req, res, next) => {
    const release = await acquireStorage();
    let operationDone = false, responseDone = false;
    const finished = () => { responseDone = true; if (operationDone) release(); };
    res.once('finish', finished); res.once('close', finished);
    if (res.destroyed) { release(); return; }
    try { await handler(req, res, next); }
    finally { operationDone = true; if (responseDone || res.destroyed) release(); }
  };
  const captureBackup = async () => {
    const release = await acquireStorage();
    try { return await exportBackup(store); } finally { release(); }
  };
  let backupInFlight = null, debounce = null;
  const runDriveBackup = () => {
    if (!backupInFlight) backupInFlight = backupToDrive(store, auth, captureBackup).catch(error => { store.setSetting('backupError', error.message); throw error; }).finally(() => { backupInFlight = null; });
    return backupInFlight;
  };
  const changed = () => {
    if (!config.automaticBackups || !auth.tokens()) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => runDriveBackup().catch(() => {}), 10000); debounce.unref();
  };
  const ensureLinks = career => { if (career.documentIds.some(id => typeof id !== 'string' || !store.document(id))) throw fault('연결할 공문 파일을 찾을 수 없습니다.'); };
  app.get('/api/data', (req, res) => { const careers = store.careers(); res.json({ careers, documents: store.documents().map(doc => publicDocument(doc, careers)) }); });
  app.get('/api/workspace', (req, res) => res.json(readWorkspace(store)));
  app.post('/api/workspace/items', locked((req, res) => {
    const workspace = saveWorkspaceItem(store, req.body);
    changed(); res.status(201).json(workspace);
  }));
  app.put('/api/workspace/items/:id', locked((req, res) => {
    const workspace = saveWorkspaceItem(store, req.body, req.params.id);
    changed(); res.json(workspace);
  }));
  app.delete('/api/workspace/items/:id', locked((req, res) => {
    const workspace = deleteWorkspaceItem(store, req.params.id, req.body?.expectedRevision);
    changed(); res.json(workspace);
  }));
  app.get('/api/workspace/export', locked((req, res) => res.json(exportWorkspaceArchive(store))));
  app.post('/api/workspace/import', locked((req, res) => {
    const result = importWorkspaceArchive(store, req.body?.archive, req.body?.expectedRevision);
    changed(); res.json(result);
  }));
  app.post('/api/careers', locked((req, res) => {
    const career = normalizeCareer({ ...req.body, id: randomUUID() }); ensureLinks(career); store.putCareer(career); changed(); res.status(201).json(career);
  }));
  app.put('/api/careers/:id', locked((req, res) => {
    const previous = store.career(req.params.id); if (!previous) throw fault('경력을 찾을 수 없습니다.', 404);
    const career = normalizeCareer(req.body, previous); ensureLinks(career); store.putCareer(career); changed(); res.json(career);
  }));
  app.delete('/api/careers/:id', locked((req, res) => { if (!store.career(req.params.id)) throw fault('경력을 찾을 수 없습니다.', 404); deleteWorkspaceCareer(store, req.params.id); changed(); res.json({ ok: true }); }));
  app.post('/api/documents', upload.array('files', 10), locked(async (req, res) => {
    if (!req.files?.length) throw fault('보관할 파일을 선택해 주세요.');
    const prepared = req.files.map(file => ({ file, ...validateFile(file) }));
    const documents = [], duplicates = [];
    for (const item of prepared) {
      const { file, name, extension, mime } = item; const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      const existing = store.byHash(sha256);
      if (existing) { duplicates.push(name); documents.push(publicDocument(existing, store.careers())); continue; }
      const id = randomUUID(), storageName = `${id}${extension}`, path = join(store.dataDir, 'originals', storageName);
      await writeFile(path, file.buffer, { mode: 0o600, flag: 'wx' });
      try {
        const extraction = await extractText(path, name);
        const document = { id, name, size: file.size, mime, createdAt: new Date().toISOString(), storageName, sha256, ...extraction };
        // A concurrent upload might have committed the same hash while extraction ran.
        const duplicate = store.byHash(sha256);
        if (duplicate) { await unlink(path); duplicates.push(name); documents.push(publicDocument(duplicate, store.careers())); continue; }
        store.putDocument(document); documents.push(publicDocument(document, store.careers()));
      } catch (error) { await unlink(path).catch(() => {}); throw error; }
    }
    changed(); res.status(201).json({ documents, duplicates });
  }));
  app.post('/api/documents/:id/link', locked((req, res) => {
    if (!store.document(req.params.id)) throw fault('공문을 찾을 수 없습니다.', 404);
    const career = store.career(req.body.careerId); if (!career) throw fault('연결할 경력을 찾을 수 없습니다.', 404);
    const updated = normalizeCareer({ documentIds: [...career.documentIds, req.params.id] }, career); store.putCareer(updated); changed(); res.json(updated);
  }));
  app.get('/api/documents/:id/file', (req, res, next) => {
    const document = store.document(req.params.id); if (!document) throw fault('공문을 찾을 수 없습니다.', 404);
    res.type(document.mime); res.download(join(store.dataDir, 'originals', document.storageName), document.name, error => { if (error) next(error); });
  });
  app.delete('/api/documents/:id', locked(async (req, res) => {
    const document = store.document(req.params.id); if (!document) throw fault('공문을 찾을 수 없습니다.', 404);
    store.transaction(() => { for (const career of store.careers()) if (career.documentIds.includes(document.id)) store.putCareer(normalizeCareer({ documentIds: career.documentIds.filter(id => id !== document.id) }, career)); store.deleteDocument(document.id); });
    await unlink(join(store.dataDir, 'originals', document.storageName)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    changed(); res.json({ ok: true });
  }));
  app.post('/api/analyze', async (req, res) => {
    const document = req.body.documentId ? store.document(req.body.documentId) : null;
    if (req.body.documentId && !document) throw fault('공문을 찾을 수 없습니다.', 404);
    if (!document && !String(req.body.text || '').trim()) throw fault('분석할 활동 내용이나 공문을 선택해 주세요.');
    res.json(await analyze({ text: req.body.text, document, path: document ? join(store.dataDir, 'originals', document.storageName) : null, apiKey: config.aiKey, fetcher: config.fetcher || networkFetch }));
  });
  app.get('/api/backup/export', locked(async (req, res) => { const buffer = await exportBackup(store); res.attachment(`career-backup-${new Date().toISOString().slice(0, 10)}.zip`).type('application/zip').send(buffer); }));
  app.post('/api/backup/restore', archiveUpload.single('file'), locked(async (req, res) => { if (!req.file) throw fault('복원할 백업 ZIP 파일을 선택해 주세요.'); res.json(await restoreBackup(store, req.file.buffer)); changed(); }));
  app.post('/api/backup/drive', async (req, res) => res.json(await runDriveBackup()));
  app.post('/api/resume/evidence', locked(async (req, res) => {
    const ids = req.body.careerIds;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !store.career(id))) throw fault('증빙을 모을 경력을 선택해 주세요.');
    const buffer = await exportBackup(store, ids); res.attachment(`경력-증빙-${new Date().toISOString().slice(0, 10)}.zip`).type('application/zip').send(buffer);
  }));
  app.post('/api/resume/hwpx/inspect', upload.single('file'), async (req, res) => {
    if (!req.file || extname(fileName(req.file.originalname)).toLowerCase() !== '.hwpx') throw fault('HWPX 양식을 올려 주세요. HWP는 한글에서 HWPX로 저장해 주세요.');
    const { inspectHwpx } = await import('./hwpx.mjs'); res.json(await inspectHwpx(req.file.buffer));
  });
  app.post('/api/resume/hwpx/fill', upload.single('file'), async (req, res) => {
    if (!req.file || extname(fileName(req.file.originalname)).toLowerCase() !== '.hwpx') throw fault('HWPX 양식을 올려 주세요.');
    let mappings;
    try { mappings = JSON.parse(req.body.mappings || '{}'); } catch { throw fault('입력할 양식 내용이 올바르지 않습니다.'); }
    const { fillHwpx } = await import('./hwpx.mjs');
    const output = await fillHwpx(req.file.buffer, mappings); res.attachment(`작성-${fileName(req.file.originalname)}`).type('application/vnd.hancom.hwpx').send(output);
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '요청한 기능을 찾을 수 없습니다.' }));
  const dist = resolve(process.env.APP_STATIC_DIR || join(serverDir, '..', 'dist'));
  if (existsSync(dist)) { app.use(express.static(dist)); app.get(/.*/, (req, res) => res.sendFile(join(dist, 'index.html'))); }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof multer.MulterError ? 400 : error.status || (error.code === 'INVALID_HWPX' ? 400 : error.code === 'ENOENT' ? 404 : 500);
    const message = error instanceof multer.MulterError ? error.code === 'LIMIT_FILE_SIZE' ? '파일 용량 제한을 초과했습니다. 공문은 25MB, 백업은 200MB까지 지원합니다.' : '한 번에 최대 10개의 파일을 올려 주세요.' : status < 500 || error.status ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    res.status(status).json({ error: message });
  });
  const timer = config.automaticBackups ? setInterval(() => { const last = store.getSetting('lastBackup'); if (auth.tokens() && (!last || Date.now() - Date.parse(last) >= 24 * 3600000)) runDriveBackup().catch(() => {}); }, 60000) : null;
  timer?.unref();
  return { app, store, auth, config, close: () => { clearInterval(timer); clearTimeout(debounce); store.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = createApp();
  const port = Number(process.env.PORT || 3001); const host = service.config.localMode ? '127.0.0.1' : '0.0.0.0';
  const server = service.app.listen(port, host, () => console.log(`경력 보관함 API: ${host}:${port} (${service.config.localMode ? '로컬 모드' : '구글 로그인 필요'})`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { service.close(); process.exit(0); }));
}
