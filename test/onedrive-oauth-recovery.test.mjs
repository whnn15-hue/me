import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFreeOneDrive } from '../server/free/onedrive.mjs';
import { createPrivateVault } from '../server/free/vault.mjs';
import { originalRequest } from '../server/vercel/entry.mjs';
import { readOneDriveOAuthError, oneDriveOAuthRecoveryURL } from '../shared/onedrive-oauth-recovery.mjs';

// Real encrypted vault, atomic conditional writes and separate runtime instances.
// All accounts, codes and tokens are invented. No network requests are made.
const config = { appUrl: 'https://archive.example', ownerEmail: 'owner@example.com', microsoftClientId: 'synthetic-client', microsoftClientSecret: 'synthetic-secret' };
const owner = { uid: 'synthetic-owner', email: config.ownerEmail };
const stateKey = state => `oauthStates/${createHash('sha256').update(state).digest('hex')}`;
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, set() { return this; },
  json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; },
  redirect(value) { this.statusCode = 302; this.redirectURL = value; return this; } });
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });

function fixture() {
  const rows = new Map(), exchanges = []; let etag = 0;
  const store = {
    async get(key) { return structuredClone(rows.get(key)?.data ?? null); },
    async getWithMetadata(key) { return structuredClone(rows.get(key) ?? null); },
    async setJSON(key, data, conditions = {}) {
      const old = rows.get(key);
      if ((conditions.onlyIfNew && old) || (conditions.onlyIfMatch && old?.etag !== conditions.onlyIfMatch)) return { modified: false };
      const row = { data: structuredClone(data), etag: String(++etag) }; rows.set(key, row);
      return { modified: true, etag: row.etag };
    },
    async delete(key) { rows.delete(key); },
  };
  let exchange = () => json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: 'Files.ReadWrite.AppFolder User.Read' });
  const fetcher = async (url, options) => {
    if (url.endsWith('/token')) { exchanges.push(new URLSearchParams(options.body)); return exchange(); }
    if (url.includes('/v1.0/me?')) return json({ id: 'synthetic-ms-owner', mail: 'owner@outlook.example' });
    throw new Error('Unexpected synthetic request');
  };
  const create = async () => {
    const vault = await createPrivateVault(store);
    return { vault, drive: createFreeOneDrive({ vault, config, fetcher,
      refreshFirebaseOwner: async (_, { uid }) => ({ uid, email: config.ownerEmail, idToken: 'synthetic-firebase' }),
    }) };
  };
  return {
    create, exchanges, setExchange: value => { exchange = value; },
    async start() {
      const { drive } = await create(), result = response();
      await drive.start({ user: owner, body: { firebaseRefreshToken: 'synthetic-firebase-refresh' } }, result);
      const authorization = new URL(result.body.url);
      return { authorization, state: authorization.searchParams.get('state') };
    },
    async callback(query) { const { drive } = await create(), result = response(); await drive.callback({ query }, result); return result; },
  };
}

function recovery(result, code) {
  assert.equal(result.statusCode, 302);
  const url = new URL(result.redirectURL);
  assert.equal(url.origin, config.appUrl); assert.equal(url.pathname, '/'); assert.equal(url.hash, '#settings');
  assert.deepEqual([...url.searchParams], [['onedriveError', code]]);
  assert.ok(readOneDriveOAuthError(code));
}

test('fresh OAuth spans runtime instances, checks PKCE and keeps the last backup and originals', async () => {
  const f = fixture(), { state, authorization } = await f.start();
  const { vault } = await f.create();
  const pending = await vault.getJSON(stateKey(state));
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
  await vault.setJSON(`lastBackup/${owner.uid}`, '2026-11-12T03:04:05Z');
  await vault.setJSON(`oneDriveFolder/${owner.uid}`, 'synthetic-existing-folder');
  const result = await f.callback({ state, code: 'synthetic-code' });
  assert.equal(result.redirectURL, config.appUrl + '/?connected=drive');
  assert.equal(f.exchanges.length, 1); assert.equal(f.exchanges[0].get('code_verifier'), pending.verifier);
  const reopened = (await f.create()).vault;
  assert.equal((await reopened.getJSON(stateKey(state))).consumed, true);
  assert.equal(await reopened.getJSON(`lastBackup/${owner.uid}`), '2026-11-12T03:04:05Z');
  assert.equal(await reopened.getJSON(`oneDriveFolder/${owner.uid}`), 'synthetic-existing-folder');
});

test('incomplete callbacks preserve the pending state for the genuine response', async () => {
  const f = fixture(), { state } = await f.start(), { vault } = await f.create();
  const before = await vault.getJSON(stateKey(state));
  for (const query of [{ state }, { state, code: '' }, { state, code: 'x'.repeat(4097) }]) {
    recovery(await f.callback(query), 'callback_incomplete');
    assert.deepEqual(await vault.getJSON(stateKey(state)), before);
  }
  assert.equal(f.exchanges.length, 0);
  assert.equal((await f.callback({ state, code: 'synthetic-code' })).redirectURL, config.appUrl + '/?connected=drive');
});

test('expired, missing and already consumed states have distinct safe recovery reasons', async () => {
  const f = fixture(), expired = await f.start(), { vault } = await f.create();
  const saved = await vault.getJSON(stateKey(expired.state));
  await vault.setJSON(stateKey(expired.state), { ...saved, expiresAt: Date.now() - 1 });
  recovery(await f.callback({ state: expired.state, code: 'synthetic-code' }), 'state_expired');
  recovery(await f.callback({ state: 'f'.repeat(64), code: 'synthetic-code' }), 'state_missing');
  const fresh = await f.start(); await f.callback({ state: fresh.state, code: 'synthetic-code' });
  recovery(await f.callback({ state: fresh.state, code: 'synthetic-code' }), 'state_used');
  assert.equal(f.exchanges.length, 1, 'reloads must never re-exchange a used code');
});

test('busy owner lease leaves a valid state pending and a later valid callback still succeeds', async () => {
  const f = fixture(), { state } = await f.start(), { vault } = await f.create();
  const before = await vault.getJSON(stateKey(state));
  const release = await vault.acquireLease(`drive/${owner.uid}`);
  try { recovery(await f.callback({ state, code: 'synthetic-code' }), 'busy'); }
  finally { await release(); }
  assert.deepEqual(await vault.getJSON(stateKey(state)), before); assert.equal(f.exchanges.length, 0);
  assert.equal((await f.callback({ state, code: 'synthetic-code' })).redirectURL, config.appUrl + '/?connected=drive');
});

test('concurrent callbacks exchange an authorization code only once', async () => {
  const f = fixture(), { state } = await f.start();
  const results = await Promise.all([f.callback({ state, code: 'synthetic-code' }), f.callback({ state, code: 'synthetic-code' })]);
  assert.equal(f.exchanges.length, 1);
  assert.equal(results.filter(result => result.redirectURL === config.appUrl + '/?connected=drive').length, 1);
  const blocked = results.find(result => result.redirectURL.includes('onedriveError='));
  assert.ok(['busy', 'state_used'].includes(new URL(blocked.redirectURL).searchParams.get('onedriveError')));
  recovery(await f.callback({ state, code: 'synthetic-code' }), 'state_used');
  assert.equal(f.exchanges.length, 1);
});

test('validated cancellation consumes its state, but invalid state and mixed query never do', async () => {
  const f = fixture(), { state } = await f.start(), { vault } = await f.create();
  const before = await vault.getJSON(stateKey(state));
  recovery(await f.callback({ state, code: 'synthetic-code', error: 'access_denied' }), 'request_invalid');
  assert.deepEqual(await vault.getJSON(stateKey(state)), before);
  recovery(await f.callback({ state, error: 'access_denied', error_description: 'SENSITIVE_UPSTREAM_TEXT' }), 'permission_declined');
  assert.equal((await vault.getJSON(stateKey(state))).consumed, true);
  recovery(await f.callback({ state, code: 'synthetic-code' }), 'state_used');
  const bad = await f.start(); const original = await vault.getJSON(stateKey(bad.state));
  await vault.setJSON(stateKey(bad.state), { ...original, provider: 'google' });
  recovery(await f.callback({ state: bad.state, error: 'access_denied' }), 'request_invalid');
  assert.equal((await vault.getJSON(stateKey(bad.state))).provider, 'google');
  assert.equal(f.exchanges.length, 0);
});

test('changed connection version and state expiry during lock acquisition cannot authorize an exchange', async () => {
  const f = fixture(), first = await f.start(), { vault } = await f.create();
  await vault.setJSON(`oneDriveConnectionVersion/${owner.uid}`, 'new-synthetic-version');
  recovery(await f.callback({ state: first.state, code: 'synthetic-code' }), 'connection_cancelled');
  const second = await f.start();
  const wrapped = { ...vault, acquireLease: async (...args) => {
    const release = await vault.acquireLease(...args);
    await vault.setJSON(stateKey(second.state), { ...await vault.getJSON(stateKey(second.state)), expiresAt: Date.now() - 1 });
    return release;
  } };
  const drive = createFreeOneDrive({ vault: wrapped, config, fetcher: () => { throw new Error('No exchange expected'); } });
  const result = response(); await drive.callback({ query: { state: second.state, code: 'synthetic-code' } }, result);
  recovery(result, 'state_expired'); assert.equal(f.exchanges.length, 0);
});

test('failed exchanges are never replayed and upstream data cannot enter the return URL', async () => {
  const f = fixture(), { state } = await f.start();
  f.setExchange(() => { throw new Error('SENSITIVE_TOKEN_AND_PROVIDER_DETAILS'); });
  recovery(await f.callback({ state, code: 'SENSITIVE_AUTH_CODE' }), 'unavailable');
  recovery(await f.callback({ state, code: 'SENSITIVE_AUTH_CODE' }), 'state_used');
  assert.equal(f.exchanges.length, 1);
  assert.equal(new URL(oneDriveOAuthRecoveryURL(config.appUrl, 'SENSITIVE_TEXT')).searchParams.get('onedriveError'), 'unavailable');
  assert.equal(readOneDriveOAuthError('__proto__'), null);
  assert.equal(readOneDriveOAuthError('unavailable&code=secret'), null);
});

test('a different Microsoft account cannot replace existing tokens, originals or the last backup', async () => {
  const f = fixture(), { state } = await f.start(), { vault } = await f.create();
  const tokens = { accountId: 'existing-account', access_token: 'synthetic-existing-access', refresh_token: 'synthetic-existing-refresh', expiresAt: 1234 };
  await vault.setJSON(`oneDriveTokens/${owner.uid}`, tokens);
  await vault.setJSON(`oneDriveFolder/${owner.uid}`, 'synthetic-existing-folder');
  await vault.setJSON(`lastBackup/${owner.uid}`, '2026-11-12T03:04:05Z');
  await vault.setJSON(`oneDriveAuthState/${owner.uid}`, { reconnectRequired: true });
  recovery(await f.callback({ state, code: 'synthetic-code' }), 'account_mismatch');
  assert.deepEqual(await vault.getJSON(`oneDriveTokens/${owner.uid}`), tokens);
  assert.equal(await vault.getJSON(`oneDriveFolder/${owner.uid}`), 'synthetic-existing-folder');
  assert.equal(await vault.getJSON(`lastBackup/${owner.uid}`), '2026-11-12T03:04:05Z');
  assert.deepEqual(await vault.getJSON(`oneDriveAuthState/${owner.uid}`), { reconnectRequired: true });
  recovery(await f.callback({ state, code: 'synthetic-code' }), 'state_used');
  assert.equal(f.exchanges.length, 1);
});

test('Vercel callback rewrite preserves state and opaque authorization code bytes', () => {
  const code = 'synthetic+code/%3D?&=.abc';
  const url = new URL('/api/career-api', config.appUrl);
  url.searchParams.set('__path', 'auth/onedrive/callback'); url.searchParams.set('path', 'auth/onedrive/callback');
  url.searchParams.set('state', 'a'.repeat(64)); url.searchParams.set('code', code);
  const restored = new URL(originalRequest(new Request(url)).url);
  assert.equal(restored.pathname, '/api/auth/onedrive/callback');
  assert.deepEqual([...restored.searchParams], [['state', 'a'.repeat(64)], ['code', code]]);
});
