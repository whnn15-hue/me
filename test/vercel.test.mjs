import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRedisStore, redisStoreConfig } from '../server/free/redis-store.mjs';
import { createPrivateVault } from '../server/free/vault.mjs';
import { defaultStoreFactory } from '../server/free/runtime.mjs';
import { createVercelHandlers, originalRequest } from '../server/vercel/entry.mjs';

// Minimal Upstash REST emulator for the two Lua scripts and DEL used by the store.
function fakeUpstash({ token = 'redis-token' } = {}) {
  const hashes = new Map(); const calls = [];
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://redis.example');
    if (options.headers.Authorization !== `Bearer ${token}`) return new Response(JSON.stringify({ error: 'WRONGPASS secret echo' }), { status: 401 });
    const args = JSON.parse(options.body); calls.push(args);
    const reply = result => new Response(JSON.stringify({ result }));
    if (args[0] === 'DEL') { hashes.delete(args[1]); return reply(1); }
    assert.equal(args[0], 'EVAL'); const [, script, , key, ...argv] = args; const row = hashes.get(key);
    if (script.includes("HGET', KEYS[1], 'v'")) return reply(row ? [row.v, row.e] : null);
    const [value, etag, mode, expected] = argv;
    if (mode === 'new' && row) return reply(0);
    if (mode === 'match' && row?.e !== expected) return reply(0);
    hashes.set(key, { v: value, e: etag }); return reply(1);
  };
  return { fetcher, hashes, calls };
}
const storeWith = fake => createRedisStore({ name: 'career-archive-private-v1', url: 'https://redis.example', token: 'redis-token', fetcher: fake.fetcher });

test('Redis store honours onlyIfNew/onlyIfMatch and namespaces keys', async () => {
  const fake = fakeUpstash(); const store = storeWith(fake);
  assert.equal(await store.get('missing'), null);
  const first = await store.setJSON('a', { n: 1 }, { onlyIfNew: true }); assert.equal(first.modified, true); assert.ok(first.etag);
  assert.equal((await store.setJSON('a', { n: 2 }, { onlyIfNew: true })).modified, false);
  assert.equal((await store.setJSON('a', { n: 3 }, { onlyIfMatch: 'stale' })).modified, false);
  const row = await store.getWithMetadata('a'); assert.deepEqual(row.data, { n: 1 }); assert.equal(row.etag, first.etag);
  const next = await store.setJSON('a', { n: 4 }, { onlyIfMatch: row.etag }); assert.equal(next.modified, true); assert.notEqual(next.etag, first.etag);
  assert.deepEqual(await store.get('a'), { n: 4 });
  await store.delete('a'); assert.equal(await store.get('a'), null);
  assert.ok([...fake.hashes.keys()].every(key => key.startsWith('career-archive-private-v1:')) || fake.hashes.size === 0);
});

test('Redis store failures never expose the upstream body, URL or token', async () => {
  const store = createRedisStore({ name: 'n', url: 'https://redis.example', token: 'wrong-token-value', fetcher: fakeUpstash().fetcher });
  await assert.rejects(store.get('x'), error => error.name === 'PrivateStoreError' && error.upstreamStatus === 401 && !/WRONGPASS|wrong-token|redis\.example/.test(error.message));
  assert.throws(() => createRedisStore({ name: 'n', url: 'http://redis.example', token: 't' }), /HTTPS/);
});

test('encrypted vault works unchanged on the Redis store (single-use and leases)', async () => {
  const fake = fakeUpstash(); const vault = await createPrivateVault(storeWith(fake));
  await vault.setJSON('driveTokens/owner', { refreshToken: 'private-refresh' });
  assert.equal((await vault.getJSON('driveTokens/owner')).refreshToken, 'private-refresh');
  assert.ok(!JSON.stringify([...fake.hashes.values()].filter(row => !row.v.includes('"key"'))).includes('private-refresh'), 'values are encrypted at rest');
  await vault.setJSON('oauth/state', { verifier: 'v' });
  assert.deepEqual(await vault.consumeJSON('oauth/state'), { verifier: 'v' }); assert.equal(await vault.consumeJSON('oauth/state'), null);
  const release = await vault.acquireLease('drive/owner');
  await assert.rejects(vault.acquireLease('drive/owner'), /진행 중/);
  await release(); const again = await vault.acquireLease('drive/owner'); await again();
  const reopened = await createPrivateVault(storeWith(fake)); assert.equal((await reopened.getJSON('driveTokens/owner')).refreshToken, 'private-refresh', 'the vault key persists across invocations');
});

test('runtime selects Redis only when Upstash credentials are present', () => {
  assert.equal(redisStoreConfig({}), null);
  assert.deepEqual(redisStoreConfig({ KV_REST_API_URL: 'https://r.example/', KV_REST_API_TOKEN: 't' }), { url: 'https://r.example', token: 't' });
  assert.deepEqual(redisStoreConfig({ UPSTASH_REDIS_REST_URL: 'https://u.example', UPSTASH_REDIS_REST_TOKEN: 'u' }), { url: 'https://u.example', token: 'u' });
  const factory = defaultStoreFactory({ KV_REST_API_URL: 'https://r.example', KV_REST_API_TOKEN: 't' }, async () => new Response('{}'));
  const store = factory({ name: 'career-archive-private-v1', consistency: 'strong' });
  assert.equal(typeof store.getWithMetadata, 'function');
  assert.equal(defaultStoreFactory({}).name, 'getStore');
});

test('rewritten /api requests reach the shared router with their original path', () => {
  const original = originalRequest(new Request('https://site.example/api/career-api?__path=auth/drive/start&x=1', { method: 'POST', body: '{}' }));
  assert.equal(new URL(original.url).pathname, '/api/auth/drive/start'); assert.equal(new URL(original.url).search, '?x=1'); assert.equal(original.method, 'POST');
  const vercel = originalRequest(new Request('https://site.example/api/career-api?__path=documents/abc/file&path=documents/abc/file'));
  assert.equal(new URL(vercel.url).pathname, '/api/documents/abc/file'); assert.equal(new URL(vercel.url).search, '');
  const kept = originalRequest(new Request('https://site.example/api/career-api?__path=status&path=other'));
  assert.equal(new URL(kept.url).search, '?path=other', 'an unrelated path query survives');
  const direct = new Request('https://site.example/api/status'); assert.equal(originalRequest(direct), direct);
});

test('only the Production deployment reaches the real runtime', async () => {
  let handled = 0; const runtime = async () => ({ handle: async request => { handled++; return new Response(new URL(request.url).pathname); } });
  for (const VERCEL_ENV of [undefined, 'preview', 'development']) {
    const { api, cronBackup, aiBackground } = createVercelHandlers({ runtime, env: { VERCEL_ENV, CRON_SECRET: 'x'.repeat(32) } });
    assert.equal((await api(new Request('https://p.example/api/career-api?__path=status'))).status, 403);
    assert.equal((await aiBackground(new Request('https://p.example/api/ai/connect/run', { method: 'POST', body: '{}' }))).status, 403);
    assert.equal((await (await cronBackup(new Request('https://p.example/api/cron-backup'))).json()).preview, true);
  }
  assert.equal(handled, 0);
  const { api } = createVercelHandlers({ runtime, env: { VERCEL_ENV: 'production' } });
  assert.equal(await (await api(new Request('https://site.example/api/career-api?__path=status'))).text(), '/api/status'); assert.equal(handled, 1);
});

test('cron backup requires the CRON_SECRET bearer token', async () => {
  let runs = 0; const runtime = async () => ({ drive: { scheduled: async () => { runs++; return { results: [{ ok: true }] }; } } });
  const secret = 's'.repeat(40); const { cronBackup } = createVercelHandlers({ runtime, env: { VERCEL_ENV: 'production', CRON_SECRET: secret } });
  for (const authorization of [undefined, 'Bearer wrong', `Bearer ${secret}x`]) {
    const response = await cronBackup(new Request('https://site.example/api/cron-backup', { headers: authorization ? { authorization } : {} })); assert.equal(response.status, 401);
  }
  const ok = await cronBackup(new Request('https://site.example/api/cron-backup', { headers: { authorization: `Bearer ${secret}` } }));
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ok: true, skipped: false }); assert.equal(runs, 1);
  const unset = createVercelHandlers({ runtime, env: { VERCEL_ENV: 'production', CRON_SECRET: '' } });
  assert.equal((await unset.cronBackup(new Request('https://site.example/api/cron-backup', { headers: { authorization: 'Bearer ' } }))).status, 401, 'an unset secret never authorizes');
  assert.equal(runs, 1);
});

test('AI connection runs after a 202 answer with the original body, like a Netlify background function', async () => {
  const seen = []; let pending;
  const runtime = async () => ({ runAiConnection: async request => { seen.push([request.method, await request.text(), request.headers.get('authorization')]); } });
  const { aiBackground } = createVercelHandlers({ runtime, env: { VERCEL_ENV: 'production' }, waitUntil: job => { pending = job; } });
  const response = await aiBackground(new Request('https://site.example/api/ai/connect/run', { method: 'POST', headers: { authorization: 'Bearer owner' }, body: '{"jobId":"j1"}' }));
  assert.equal(response.status, 202); await pending;
  assert.deepEqual(seen, [['POST', '{"jobId":"j1"}', 'Bearer owner']]);
  assert.equal((await aiBackground(new Request('https://site.example/api/ai/connect/run'))).status, 405);
});

test('vercel.json mirrors the Netlify routes, headers and schedule', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const toml = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.equal(config.buildCommand, 'node scripts/vercel-build.mjs'); assert.equal(config.outputDirectory, 'dist');
  assert.deepEqual(config.crons, [{ path: '/api/cron-backup', schedule: /schedule = "([^"]+)"/.exec(toml)[1] }]);
  assert.equal(config.rewrites[0].destination, '/api/career-ai-background');
  assert.match(config.rewrites[1].destination, /^\/api\/career-api\?__path=:path$/);
  assert.equal(config.rewrites.at(-1).destination, '/index.html');
  const vercelHeaders = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  const netlifyCsp = /Content-Security-Policy = "([^"]+)"/.exec(toml)[1];
  for (const name of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security']) assert.ok(toml.includes(`${name} = "${vercelHeaders[name]}"`), name);
  // Same policy, plus the Microsoft hosts needed for OneDrive.
  const strip = csp => csp.replace(/ https:\/\/(login\.microsoftonline\.com|graph\.microsoft\.com|[^ ;]*1drv[^ ;]*|[^ ;]*sharepoint[^ ;]*|[^ ;]*onedrive[^ ;]*|[^ ;]*microsoftpersonalcontent[^ ;]*|[^ ;]*live\.com[^ ;]*)/g, '');
  assert.equal(strip(vercelHeaders['Content-Security-Policy']), netlifyCsp);
  for (const entry of Object.keys(config.functions)) await readFile(new URL(`../${entry}`, import.meta.url));
  const build = await readFile(new URL('../scripts/vercel-build.mjs', import.meta.url), 'utf8');
  assert.match(build, /VERCEL_ENV === 'production'/); assert.match(build, /PREVIEW_OUT_DIR: 'dist'/);
});
