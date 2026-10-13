import { createFreeAuth } from './auth.mjs';
import { createFreeDrive } from './drive.mjs';
import { FreeRestRepository } from './repository.mjs';
import { createDriveBackup, readDriveFile, extractFile, fault, safeName, MAX_FILE_SIZE } from './files.mjs';
import { freeAnalyze } from './analyze.mjs';
import { inspectHwpx, fillHwpx } from '../hwpx.mjs';
import { extname } from 'node:path';
import { networkFetch } from '../auth.mjs';
import { validateFile } from '../cloud/files.mjs';
import { createAutomaticSnapshot } from './snapshot.mjs';
import { budgetedFetch, runWithDeadline } from './deadline.mjs';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
function safeOrigin(raw) { try { const url = new URL(raw); return url.protocol === 'https:' && url.origin === raw && !url.username && !url.password ? url.origin : null; } catch { return null; } }
function responseAdapter() {
  let status = 200, response;
  const adapter = { status(value) { status = value; return adapter; }, json(value) { response = json(value, status); return response; }, send(value) { response = new Response(String(value), { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); return response; }, redirect(url) { response = new Response(null, { status: 302, headers: { Location: url } }); return response; } };
  return { adapter, getResponse: () => response };
}
export function createFreeApi({ config, vault, fetcher = networkFetch, auth, repositoryFactory = values => new FreeRestRepository(values), extract = extractFile }) {
  config = { ...config, projectId: String(config.projectId || '').trim(), ownerEmail: String(config.ownerEmail || '').trim().toLowerCase(), firebaseWebApiKey: String(config.firebaseWebApiKey || '').trim() };
  fetcher = budgetedFetch(fetcher);
  auth ||= createFreeAuth(config, { fetcher });
  const origin = safeOrigin(config.appUrl); const configured = Boolean(origin && /^[A-Za-z0-9-]+$/.test(config.projectId) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.ownerEmail) && config.firebaseWebApiKey);
  let drive;
  const captureBackup = createDriveBackup({ config, fetcher, getDrive: () => drive, repositoryFactory });
  const captureSnapshot = createAutomaticSnapshot({ config, fetcher, repositoryFactory });
  drive = createFreeDrive({ vault, config, fetcher, captureBackup, captureSnapshot, refreshFirebaseOwner: auth.refreshFirebaseOwner });
  const repoFor = user => repositoryFactory({ projectId: config.projectId, uid: user.uid, idToken: user.token, fetcher });
  const bridge = async (handler, req) => { const { adapter, getResponse } = responseAdapter(); const result = await handler(req, adapter); return getResponse() || (result instanceof Response ? result : json(result || { ok: true })); };
  async function handle(request) {
    const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin && requestOrigin !== origin) return json({ error: '허용되지 않은 요청 출처입니다.' }, 403, responseHeaders);
    if (requestOrigin && origin) Object.assign(responseHeaders, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' });
    if (request.method === 'OPTIONS') return new Response(null, { status: configured && requestOrigin === origin ? 204 : 403, headers: responseHeaders });
    let response;
    try {
      const url = new URL(request.url); let path = url.pathname;
      if (path.startsWith('/.netlify/functions/career-api')) path = '/api' + path.slice('/.netlify/functions/career-api'.length);
      const query = Object.fromEntries(url.searchParams);
      if (path === '/api/auth/callback' && request.method === 'GET') response = await bridge(drive.callback, { query });
      else {
        const statusBase = { mode: 'firebase', backend: 'netlify-free', user: null, googleConfigured: configured, ownerConfigured: Boolean(config.ownerEmail), aiConfigured: Boolean(config.aiEnabled && config.geminiKey), driveConfigured: configured && drive.configured, driveConnected: false, lastBackup: null };
        if (path === '/api/status' && request.method === 'GET' && !request.headers.get('authorization')) response = json(statusBase);
        else {
          if (!configured) throw fault('앱 주소, Firebase 웹 설정과 본인 계정을 먼저 설정해 주세요.', 503);
          const user = await auth.identify(request); let body = {};
          if (!['GET', 'HEAD'].includes(request.method)) {
            const raw = await request.text(); if (Buffer.byteLength(raw) > 1024 * 1024) throw fault('요청 내용이 너무 큽니다. 원본 파일은 구글 드라이브로 직접 올려 주세요.', 413);
            if (raw) { try { body = JSON.parse(raw); } catch { throw fault('요청 내용이 올바르지 않습니다.'); } }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw fault('요청 내용이 올바르지 않습니다.');
          }
          const req = { user, body, query };
          if (path === '/api/status' && request.method === 'GET') response = json({ ...statusBase, user: { uid: user.uid, email: user.email, name: user.name }, ...(await drive.status(user)) });
          else if (path === '/api/auth/drive/start' && request.method === 'POST') response = await bridge(drive.start, req);
          else if (path === '/api/auth/drive/access' && request.method === 'POST') response = await bridge(drive.access, req);
          else if (path === '/api/auth/drive/disconnect' && request.method === 'POST') response = await bridge(drive.disconnect, req);
          else if (path === '/api/auth/logout' && request.method === 'POST') response = json({ ok: true });
          else if (path === '/api/documents/extract' && request.method === 'POST') {
            if (!Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_FILE_SIZE || !/^[a-f0-9]{64}$/.test(body.sha256 || '')) throw fault('공문 파일 정보가 올바르지 않습니다.');
            const file = await readDriveFile(drive, fetcher, user.uid, body.driveFileId, { kind: 'document', size: body.size, sha256: body.sha256 });
            validateFile({ originalname: file.name, buffer: file.buffer });
            response = json(await extract(file.buffer, file.name));
          } else if (path === '/api/analyze' && request.method === 'POST') {
            const snapshot = body.documentId ? await repoFor(user).snapshot() : null; const document = snapshot?.documents.find(value => value.id === body.documentId);
            if (body.documentId && !document) throw fault('공문을 찾을 수 없습니다.', 404);
            if (!document && !String(body.text || '').trim()) throw fault('분석할 활동 내용이나 공문을 선택해 주세요.');
            let buffer;
            if (document && !String(body.text || document.text || '').trim() && config.aiEnabled && config.geminiKey) buffer = (await readDriveFile(drive, fetcher, user.uid, document.driveFileId, { kind: 'document', size: document.size, sha256: document.sha256 })).buffer;
            response = json(await freeAnalyze({ text: body.text, document, buffer, config, fetcher }));
          } else if (['/api/resume/template', '/api/resume/hwpx/inspect'].includes(path) && request.method === 'POST') {
            const file = await readDriveFile(drive, fetcher, user.uid, body.driveFileId || body.templateFileId, { kind: 'template', ...(body.size !== undefined ? { size: body.size } : {}) });
            if (extname(file.name).toLowerCase() !== '.hwpx') throw fault('HWPX 양식을 올려 주세요. HWP는 한글에서 HWPX로 저장해 주세요.');
            response = json(await inspectHwpx(file.buffer));
          } else if (['/api/resume/template/fill', '/api/resume/hwpx/fill'].includes(path) && request.method === 'POST') {
            const file = await readDriveFile(drive, fetcher, user.uid, body.templateFileId || body.driveFileId, { kind: 'template' });
            if (extname(file.name).toLowerCase() !== '.hwpx') throw fault('HWPX 양식을 올려 주세요.');
            const output = await fillHwpx(file.buffer, body.mappings || {});
            response = json(await drive.upload(user.uid, output, `작성-${safeName(file.name)}`, 'application/vnd.hancom.hwpx', 'output'));
          } else if (path === '/api/backup/drive' && request.method === 'POST') response = json(await drive.backup({ uid: user.uid, email: user.email, idToken: user.token }));
          else if (path === '/api/backup/export' && request.method === 'GET') response = json(await drive.upload(user.uid, await captureBackup(user.uid, { idToken: user.token }), `career-backup-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip', 'backup'));
          else if (path === '/api/resume/evidence' && request.method === 'POST') response = json(await drive.upload(user.uid, await captureBackup(user.uid, { idToken: user.token, selectedIds: body.careerIds }), `경력-증빙-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip', 'output'));
          else response = json({ error: '요청한 기능을 찾을 수 없습니다.' }, 404);
        }
      }
    } catch (error) {
      const status = error.status || (error.code === 'INVALID_HWPX' ? 400 : 500);
      response = json({ error: status < 500 || error.status ? error.message : '요청을 처리하지 못했습니다. 무료 서비스 연결과 설정을 확인해 주세요.' }, status);
    }
    for (const [name, value] of Object.entries(responseHeaders)) response.headers.set(name, value);
    return response;
  }
  return { handle: request => runWithDeadline(() => handle(request)), drive, configured };
}
