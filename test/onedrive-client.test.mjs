import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({
  stdin: { contents: `export * from './src/free/onedrive'; export {readDriveStorage,uploadDriveFile} from './src/free/drive';`, resolveDir: new URL('..', import.meta.url).pathname, sourcefile: 'onedrive-client-test.ts', loader: 'ts' },
  bundle: true, platform: 'browser', format: 'esm', write: false,
  plugins: [{ name: 'owner-only-api', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/(api|cloud)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.endsWith('/api')
      ? 'export const api=(...args)=>globalThis.__oneDriveApi(...args);'
      : 'export const readyCloudUser=async()=>({uid:"owner"}); export const cloudUserError=()=>null;' }));
  } }],
});
const client = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
const GRAPH = 'https://graph.microsoft.com/v1.0';
const FOLDER = 'ABCDEF0123456789!100', ITEM = 'ABCDEF0123456789!200';
const UPLOAD = 'https://api.onedrive.com/rup/private-session';
const freshAccess = token => ({ provider: 'onedrive', folderId: FOLDER, accessToken: token });
const json = (body = {}, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const restoredContexts = new WeakSet();

function fixture(t, respond, refresh = () => freshAccess('fresh')) {
  if (!restoredContexts.has(t)) {
    restoredContexts.add(t);
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; delete globalThis.__oneDriveApi; });
  }
  const calls = [], apiCalls = [];
  globalThis.__oneDriveApi = async (path, options) => {
    apiCalls.push({ path, options });
    assert.equal(path, '/auth/drive/access'); assert.equal(options.method, 'POST');
    if (options.body) { assert.deepEqual(JSON.parse(options.body), { forceRefresh: true }); return refresh(); }
    return freshAccess('stale');
  };
  globalThis.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    calls.push({ url, method: options.method || 'GET', headers, body: options.body });
    assert.equal(options.credentials, 'omit');
    if (!url.startsWith(GRAPH + '/')) assert.equal(headers.get('Authorization'), null, 'pre-authorized URL must never receive the Graph token');
    return respond(url, options, headers, calls);
  };
  return { calls, apiCalls };
}

test('a rejected Graph token is refreshed once through the owner API before retrying the same request', async t => {
  const f = fixture(t, (url, options, headers) => {
    assert.equal(url, GRAPH + '/me/drive?$select=quota');
    return headers.get('Authorization') === 'Bearer stale' ? json({}, 401) : json({ quota: { used: 10, total: 100 } });
  });
  const quota = await client.readDriveStorage();
  assert.ok(quota);
  assert.equal(f.calls.length, 2); assert.equal(f.apiCalls.length, 2);
  assert.equal(f.calls[1].headers.get('Authorization'), 'Bearer fresh');
});

test('a second Graph 401 stops without a refresh loop', async t => {
  const f = fixture(t, () => json({ secret: 'not-for-the-user' }, 401));
  await assert.rejects(client.readDriveStorage(), error => /다시 연결/.test(error.message) && !error.message.includes('secret'));
  assert.equal(f.calls.length, 2); assert.equal(f.apiCalls.length, 2);
});

test('provider and folder changes during refresh never send the new token to the old archive', async t => {
  for (const changed of [{ provider: 'google', folderId: FOLDER, accessToken: 'different-account' }, { ...freshAccess('different-account'), folderId: 'ABCDEF0123456789!999' }]) {
    const f = fixture(t, () => json({}, 401), () => changed);
    await assert.rejects(client.readDriveStorage(), /보관 계정이 변경/);
    assert.equal(f.calls.length, 1); assert.equal(f.apiCalls.length, 2);
    assert.ok(!f.calls.some(call => call.headers.get('Authorization') === 'Bearer different-account'));
  }
});

test('ordinary Graph service errors do not trigger token rotation', async t => {
  const f = fixture(t, () => json({}, 503));
  await assert.rejects(client.readDriveStorage(), /503/);
  assert.equal(f.calls.length, 1); assert.equal(f.apiCalls.length, 1);
});

test('upload session creation recovers a Graph 401 without sending a token to the upload URL', async t => {
  let sessions = 0, chunks = 0;
  const f = fixture(t, (url, options, headers) => {
    if (url.endsWith('/createUploadSession')) {
      sessions++;
      return headers.get('Authorization') === 'Bearer stale' ? json({}, 401) : json({ uploadUrl: UPLOAD });
    }
    if (url === UPLOAD && options.method === 'PUT') { chunks++; return json({ id: ITEM, name: 'proof.txt' }, 201); }
    if (url === GRAPH + '/me/drive/items/' + encodeURIComponent(ITEM) && options.method === 'PATCH') return json({ id: ITEM });
    assert.fail('Unexpected request');
  });
  const saved = await client.uploadDriveFile(new File(['proof'], 'proof.txt'), 'document');
  assert.equal(saved.id, ITEM); assert.equal(sessions, 2); assert.equal(chunks, 1); assert.equal(f.apiCalls.length, 2);
  assert.ok(!f.calls.some(call => call.method === 'DELETE'));
});

test('metadata 401 after upload retries only the metadata write and keeps one original', async t => {
  let sessions = 0, chunks = 0, labels = 0;
  const f = fixture(t, (url, options, headers) => {
    if (url.endsWith('/createUploadSession')) { sessions++; return json({ uploadUrl: UPLOAD }); }
    if (url === UPLOAD && options.method === 'PUT') { chunks++; return json({ id: ITEM, name: 'proof.txt' }, 201); }
    if (url === GRAPH + '/me/drive/items/' + encodeURIComponent(ITEM) && options.method === 'PATCH') {
      labels++; return headers.get('Authorization') === 'Bearer stale' ? json({}, 401) : json({ id: ITEM });
    }
    assert.fail('Unexpected request');
  });
  const saved = await client.uploadDriveFile(new File(['proof'], 'proof.txt'), 'document');
  assert.equal(saved.id, ITEM); assert.equal(saved.appProperties.archiveUid, 'owner');
  assert.equal(sessions, 1); assert.equal(chunks, 1); assert.equal(labels, 2); assert.equal(f.apiCalls.length, 2);
  assert.ok(!f.calls.some(call => call.method === 'DELETE'));
});

test('an expired upload session is not misreported as account expiry and never restarts the upload', async t => {
  for (const status of [401, 404]) {
    let chunks = 0;
    const f = fixture(t, (url, options) => {
      if (url.endsWith('/createUploadSession')) return json({ uploadUrl: UPLOAD });
      if (url === UPLOAD && options.method === 'PUT') { chunks++; return json({ privateURL: UPLOAD }, status); }
      if (url === UPLOAD && options.method === 'DELETE') return json({}, 204);
      assert.fail('Unexpected request');
    });
    await assert.rejects(client.uploadDriveFile(new File(['proof'], 'proof.txt'), 'document'), error => {
      assert.match(error.message, /업로드 연결/); assert.match(error.message, new RegExp(String(status)));
      assert.doesNotMatch(error.message, /인증이 만료|다시 연결|private-session/); return true;
    });
    assert.equal(chunks, 1); assert.equal(f.apiCalls.length, 1);
    assert.equal(f.calls.filter(call => call.url === UPLOAD && call.method === 'DELETE').length, 1);
  }
});

test('expired download URLs do not receive a Graph token or request account reconnection', async t => {
  const f = fixture(t, () => json({}, 401));
  await assert.rejects(client.downloadOneDriveContent('https://storage.example/private-download'), error => /다운로드 주소/.test(error.message) && !/인증이 만료|다시 연결/.test(error.message));
  assert.equal(f.calls.length, 1); assert.equal(f.apiCalls.length, 0);
});

test('refreshed metadata still requires the same owner and folder before reading a file', async t => {
  let refreshed = 0;
  const credentials = { ...freshAccess('stale'), refresh: async () => { refreshed++; return freshAccess('fresh'); } };
  fixture(t, (url, options, headers) => headers.get('Authorization') === 'Bearer stale'
    ? json({}, 401)
    : json({ id: ITEM, name: 'proof.txt', parentReference: { id: FOLDER }, description: JSON.stringify({ v: 1, archiveUid: 'someone-else', kind: 'document' }) }));
  await assert.rejects(client.ownedOneDriveItem(ITEM, credentials, 'owner'), /내 경력 보관함/);
  assert.equal(refreshed, 1);
});
