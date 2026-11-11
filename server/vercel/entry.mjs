import { freeRuntime } from '../free/runtime.mjs';
import { backendFailure } from '../free/errors.mjs';
import { runWithDeadline } from '../free/deadline.mjs';
import { timingSafeEqual } from 'node:crypto';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });

// Only the Production deployment may reach the owner's Firebase/storage data.
// Preview and development deployments answer like the Netlify preview functions.
export const isProduction = (env = process.env) => env.VERCEL_ENV === 'production';
const previewApi = () => json({ error: '미리보기는 브라우저 안에서만 동작합니다. 실제 데이터 서버에는 연결하지 않습니다.' }, 403);

// vercel.json rewrites /api/<path> to /api/career-api?__path=<path>. Rebuild the
// original URL so the shared router sees the same /api/... path as on Netlify.
export function originalRequest(request) {
  const url = new URL(request.url);
  if (!url.searchParams.has('__path')) return request;
  const path = url.searchParams.get('__path').replace(/^\/+/, '');
  url.searchParams.delete('__path');
  // Vercel also appends the named rewrite parameter as ?path=<same value>.
  if (url.searchParams.getAll('path').includes(path)) url.searchParams.delete('path', path);
  url.pathname = '/api/' + path;
  return new Request(url, request);
}

export function createVercelHandlers({ runtime = freeRuntime, env = process.env, waitUntil } = {}) {
  async function api(request) {
    if (!isProduction(env)) return previewApi();
    try { return await (await runtime()).handle(originalRequest(request)); }
    catch (error) { const failure = backendFailure(error, 'runtime'); return json({ error: failure.message, code: failure.code }, failure.status); }
  }
  // Netlify background functions answer 202 and keep running. On Vercel the
  // body is read first, then the job continues inside waitUntil (bounded by the
  // function's maxDuration in vercel.json).
  async function aiBackground(request) {
    if (!isProduction(env)) return previewApi();
    if (request.method !== 'POST') return json({ error: '허용되지 않은 요청입니다.' }, 405);
    const body = await request.text();
    const copy = new Request(request.url, { method: 'POST', headers: request.headers, body });
    const job = (async () => { try { await (await runtime()).runAiConnection(copy); } catch (error) { backendFailure(error, 'ai-worker'); } })();
    if (waitUntil) waitUntil(job); else await job;
    return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  }
  // Vercel Cron calls this path with "Authorization: Bearer $CRON_SECRET".
  // Unlike Netlify scheduled functions the URL is public, so the secret is required.
  async function cronBackup(request) {
    if (!isProduction(env)) return json({ ok: true, skipped: true, preview: true });
    const secret = String(env.CRON_SECRET || '');
    const given = Buffer.from(request.headers.get('authorization') || ''), expected = Buffer.from(`Bearer ${secret}`);
    if (secret.length < 16 || given.length !== expected.length || !timingSafeEqual(given, expected)) return json({ error: '허용되지 않은 요청입니다.' }, 401);
    try {
      const result = await runWithDeadline(async () => (await runtime()).drive.scheduled(), 55000);
      return json({ ok: !result.results?.some(item => item.ok === false), skipped: Boolean(result.skipped) });
    } catch { return json({ error: '예약 백업 연결을 확인해 주세요.' }, 503); }
  }
  return { api, aiBackground, cronBackup };
}
