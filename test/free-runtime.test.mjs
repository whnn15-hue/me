import test from 'node:test';
import assert from 'node:assert/strict';
import { getStore, setEnvironmentContext } from '@netlify/blobs';
import { createFreeRuntime } from '../server/free/runtime.mjs';
import { createFreeApi } from '../server/free/api.mjs';
import { backendFailure } from '../server/free/errors.mjs';
import careerApi from '../netlify/functions/career-api.mjs';

const env = { APP_URL: 'https://career.example', OWNER_EMAIL: 'owner@example.com', APP_FIREBASE_PROJECT_ID: 'introduce-93ff8', APP_FIREBASE_WEB_API_KEY: 'public-key', APP_DRIVE_ENABLED: 'false' };
const user = { uid: 'owner-uid', email: env.OWNER_EMAIL, name: 'Owner', token: 'never-log-owner-token' };
const auth = { identify: async request => { if (request.headers.get('Authorization') !== 'Bearer owner') throw Object.assign(new Error('본인 계정으로 로그인해 주세요.'), { status: 401 }); return user; } };
test('basic login and anonymous readiness do not bootstrap or read optional Drive Blobs', async () => {
  let stores = 0; const runtime = createFreeRuntime({ env, authFactory: () => auth, storeFactory: () => { stores++; throw new Error('optional vault unavailable'); } });
  const service = await runtime();
  const anonymous = await service.handle(new Request(env.APP_URL + '/api/status'));
  assert.equal(anonymous.status, 200); assert.equal((await anonymous.json()).user, null);
  const response = await service.handle(new Request(env.APP_URL + '/api/status', { headers: { Authorization: 'Bearer owner' } })); const status = await response.json();
  assert.equal(response.status, 200); assert.equal(status.user.email, env.OWNER_EMAIL); assert.equal(status.driveConfigured, false); assert.equal(stores, 0);
  const forbidden = await service.handle(new Request(env.APP_URL + '/api/status', { headers: { Authorization: 'Bearer other' } })); assert.equal(forbidden.status, 401); assert.equal(stores, 0);
});
test('fresh invocation reads current SDK Blobs context while retaining the same vault key and encrypted credentials', async () => {
  const values = new Map(); let etag = 0, activeToken = 'context-first'; const seenTokens = []; let storeCreations = 0;
  const fetcher = async (raw, options) => {
    const url = new URL(raw), headers = new Headers(options.headers); seenTokens.push(headers.get('Authorization'));
    assert.equal(headers.get('Authorization'), `Bearer ${activeToken}`, 'an invocation must not retain the previous context token');
    assert.equal(url.origin, 'https://strong.example'); const existing = values.get(url.pathname);
    if (options.method.toUpperCase() === 'GET') return existing ? new Response(JSON.stringify(existing.value), { headers: { etag: existing.etag } }) : new Response(null, { status: 404 });
    if (headers.get('if-none-match') === '*' && existing || headers.has('if-match') && headers.get('if-match') !== existing?.etag) return new Response(null, { status: 412 });
    const current = { value: JSON.parse(options.body), etag: String(++etag) }; values.set(url.pathname, current); return new Response(null, { headers: { etag: current.etag } });
  };
  const context = token => setEnvironmentContext({ siteID: 'private-site', token, edgeURL: 'https://edge.example', uncachedEdgeURL: 'https://strong.example' });
  const runtime = createFreeRuntime({ env, authFactory: () => auth, apiFactory: values => values, storeFactory: options => { storeCreations++; return getStore({ ...options, fetch: fetcher }); } });
  try {
    context(activeToken); const first = await runtime(); await first.vault.setJSON('driveTokens/owner-uid', { refreshToken: 'private-value' });
    const privateKey = [...values.values()].find(row => row.value.key)?.value.key; assert.ok(privateKey); assert.equal(storeCreations, 1);
    activeToken = 'context-second'; context(activeToken); const second = await runtime(); assert.equal((await second.vault.getJSON('driveTokens/owner-uid')).refreshToken, 'private-value'); assert.equal(storeCreations, 2);
    assert.equal([...values.values()].find(row => row.value.key)?.value.key, privateKey, 'context rotation must preserve the vault key and existing credentials');
    assert.ok(seenTokens.includes('Bearer context-second')); assert.ok(!JSON.stringify([...values.values()]).includes('private-value'));
  } finally { setEnvironmentContext({}); }
});
test('optional Drive context failures return a safe JSON diagnostic without SDK response bodies or credentials', async () => {
  const calls = []; const sdkError = Object.assign(new Error('secret-token-and-private-url'), { name: 'BlobsInternalError', status: 403, responseBody: 'secret-response-body' });
  const config = { appUrl: env.APP_URL, ownerEmail: env.OWNER_EMAIL, projectId: env.APP_FIREBASE_PROJECT_ID, firebaseWebApiKey: env.APP_FIREBASE_WEB_API_KEY, driveEnabled: true, googleClientId: 'public-client', googleClientSecret: 'never-log-secret' };
  const api = createFreeApi({ config, auth, logger: (...args) => calls.push(args), vault: { getJSON: async () => { throw sdkError; } } });
  const response = await api.handle(new Request(env.APP_URL + '/api/status', { headers: { Authorization: 'Bearer owner' } })); const data = await response.json();
  assert.equal(response.status, 503); assert.equal(data.code, 'BLOBS_REQUEST_FAILED'); assert.ok(!JSON.stringify([data, calls]).includes('secret-'));
  assert.equal(calls[0][1].stage, 'drive-status'); assert.equal(calls[0][1].type, 'BlobsInternalError'); assert.equal(calls[0][1].upstreamStatus, 403);
  for (const [name, code] of [['MissingBlobsEnvironmentError', 'BLOBS_CONTEXT_MISSING'], ['BlobsConsistencyError', 'BLOBS_CONSISTENCY_UNAVAILABLE']]) assert.equal(backendFailure({ name }, 'runtime', () => {}).code, code);
});
test('Netlify entry can answer anonymous status outside Blobs context and returns JSON rather than failing before setup', async () => {
  const response = await careerApi(new Request('https://career.example/api/status')); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.user, null); assert.equal(data.mode, 'firebase');
});
