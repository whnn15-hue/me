import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

test('API keeps same-origin protection cookies and Firebase bearer auth, with safe HTTP errors', {
  skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()),
}, async () => {
  const output = await build({
    entryPoints: ['src/api.ts'], absWorkingDir: new URL('..', import.meta.url).pathname,
    bundle: true, platform: 'browser', format: 'iife', globalName: 'apiFixture', write: false,
    plugins: [{ name: 'isolated-auth-fixture', setup(builder) {
      builder.onResolve({ filter: /^\.\/cloud$/ }, () => ({ path: 'cloud', namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\/free\/(?:api|drive)$/ }, () => ({ path: 'free', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'cloud' ? `
        export const cloudMode = true;
        export const freeMode = globalThis.fixture.mode === 'free';
        export const cloudConfigurationError = '';
        export const cloudApiUrl = path => globalThis.fixture.base + '/api' + path + '?scenario=' + globalThis.fixture.scenario;
        export const cloudToken = async () => 'fixture-firebase-token';
        export const cloudUserError = () => '';
        export const readyCloudUser = async () => ({uid:'fixture-owner', email:'owner@example.test'});
        export const signedOutCloudStatus = () => ({user:null});
      ` : `
        export const freeApi = async () => ({handled:false});
        export const prepareTemplateRequest = async (path, options) => options;
        export const downloadDriveFile = async () => { throw new Error('Unused fixture path'); };
      ` }));
    } }],
  });
  const bundle = output.outputFiles[0].text;
  const requests = [];
  let externalOrigin;
  const respond = (external = false) => (request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    if (external) {
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin || '*');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    }
    if (url.pathname === '/bundle.js') {
      response.setHeader('Content-Type', 'application/javascript'); response.end(bundle); return;
    }
    if (url.pathname === '/fixture') {
      response.setHeader('Set-Cookie', 'netlify_gate=passed; HttpOnly; SameSite=Lax; Path=/');
      response.setHeader('Content-Type', 'text/html');
      const mode = url.searchParams.get('mode') || 'free';
      const base = mode === 'free' ? '' : externalOrigin;
      const scenario = url.searchParams.get('scenario') || 'ok';
      response.end(`<script>globalThis.fixture=${JSON.stringify({ mode, base, scenario })}</script><script src="/bundle.js"></script>`); return;
    }
    if (url.pathname !== '/api/status') { response.writeHead(404).end(); return; }
    requests.push({ external, cookie: request.headers.cookie || '', authorization: request.headers.authorization });
    if (!external && !request.headers.cookie?.includes('netlify_gate=passed')) {
      response.writeHead(401, { 'Content-Type': 'text/html' }).end('<html>Protection gate</html>'); return;
    }
    if (request.headers.authorization !== 'Bearer fixture-firebase-token') {
      response.writeHead(403, { 'Content-Type': 'application/json' }).end('{"error":"Firebase authentication required"}'); return;
    }
    const scenario = url.searchParams.get('scenario');
    if (scenario === 'html503' || scenario === 'html200') {
      response.writeHead(scenario === 'html503' ? 503 : 200, { 'Content-Type': 'text/html' })
        .end('<html>PRIVATE_HTML_AND_TOKEN_MUST_NOT_APPEAR</html>'); return;
    }
    if (scenario === 'json401') {
      response.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"본인 계정으로 다시 로그인해 주세요."}'); return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      mode: 'firebase', ownerConfigured: true, user: { name: 'Fixture Owner', email: 'owner@example.test' },
    }));
  };
  const main = createServer(respond()), external = createServer(respond(true));
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = server => new Promise(resolve => server.close(resolve));
  let browser;
  try {
    await Promise.all([listen(main), listen(external)]);
    externalOrigin = `http://127.0.0.1:${external.address().port}`;
    const origin = `http://127.0.0.1:${main.address().port}`;
    browser = await chromium.launch({ executablePath: existsSync(chromiumPath) ? chromiumPath : undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const call = async (mode, scenario = 'ok') => {
      await page.goto(`${origin}/fixture?mode=${mode}&scenario=${scenario}`);
      return page.evaluate(async () => {
        try { return { value: await globalThis.apiFixture.api('/status'), cookieVisible: document.cookie }; }
        catch (error) { return { error: error.message }; }
      });
    };
    const free = await call('free');
    assert.equal(free.value.user.email, 'owner@example.test');
    assert.equal(free.cookieVisible, ''); // The protection cookie is HttpOnly.
    assert.match(requests.at(-1).cookie, /netlify_gate=passed/);
    assert.equal(requests.at(-1).authorization, 'Bearer fixture-firebase-token');
    const paid = await call('paid');
    assert.equal(paid.value.user.email, 'owner@example.test');
    assert.equal(requests.at(-1).external, true);
    assert.equal(requests.at(-1).cookie, '');
    assert.equal(requests.at(-1).authorization, 'Bearer fixture-firebase-token');
    for (const [scenario, status] of [['html503', 503], ['html200', 200]]) {
      const result = await call('free', scenario);
      assert.match(result.error, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(result.error, /PRIVATE_HTML|TOKEN_MUST|<html>/);
    }
    assert.equal((await call('free', 'json401')).error, '본인 계정으로 다시 로그인해 주세요.');
  } finally {
    await browser?.close();
    await Promise.all([close(main), close(external)]);
  }
});
